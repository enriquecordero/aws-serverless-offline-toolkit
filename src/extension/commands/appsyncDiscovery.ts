import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MockDataSource } from '../../shared/types';

export interface AppSyncConfigInput {
    schemaPath: string;
    resolversPath: string;
    mockDataPath: string;
}

export interface AppSyncProjectDiscovery {
    workspaceRoot: string;
    schemaPath: string;
    resolversDir?: string;
    mockDataPath?: string;
    dataSources: MockDataSource[];
}

export interface DiscoveryPickOptions {
    promptIfMultiple?: boolean;
    quickPickTitle?: string;
}

export async function discoverAppSyncProject(config: AppSyncConfigInput): Promise<AppSyncProjectDiscovery | undefined> {
    const all = await discoverAppSyncProjects(config);
    return all[0];
}

export async function pickAppSyncProject(
    config: AppSyncConfigInput,
    options: DiscoveryPickOptions = {}
): Promise<AppSyncProjectDiscovery | undefined> {
    const all = await discoverAppSyncProjects(config);
    if (all.length === 0) {
        return undefined;
    }
    if (all.length === 1 || !options.promptIfMultiple) {
        return all[0];
    }

    const items = all.map(project => {
        const schemaRel = toWorkspaceRelativePath(project.workspaceRoot, project.schemaPath);
        const workspaceName = path.basename(project.workspaceRoot);
        const resolversRel = project.resolversDir
            ? toWorkspaceRelativePath(project.workspaceRoot, project.resolversDir)
            : '(no resolvers path)';
        return {
            label: `${workspaceName}: ${schemaRel}`,
            description: `resolvers: ${resolversRel}`,
            project,
        };
    });

    const picked = await vscode.window.showQuickPick(items, {
        title: options.quickPickTitle ?? 'Select AppSync project',
        placeHolder: 'Multiple AppSync schemas found. Choose one project.',
        ignoreFocusOut: true,
    });

    return picked?.project;
}

export async function discoverAppSyncProjects(config: AppSyncConfigInput): Promise<AppSyncProjectDiscovery[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
        return [];
    }

    const schemaCandidates = await findSchemaCandidates(config.schemaPath);
    const projects: AppSyncProjectDiscovery[] = [];

    for (const schemaPath of schemaCandidates) {
        const workspaceRoot = findWorkspaceRootForPath(schemaPath) ?? workspaceFolders[0].uri.fsPath;
        const resolversDir = findResolversDir(workspaceRoot, schemaPath, config.resolversPath);
        const mockDataPath = findMockDataPath(workspaceRoot, schemaPath, config.mockDataPath);

        projects.push({
            workspaceRoot,
            schemaPath,
            resolversDir,
            mockDataPath,
            dataSources: mockDataPath
                ? [{ name: 'MockDB', type: 'JSON_FILE', filePath: mockDataPath }]
                : [{ name: 'MockDB', type: 'IN_MEMORY', data: {} }],
        });
    }

    return projects;
}

export function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
    const rel = path.relative(workspaceRoot, absolutePath);
    return rel.split(path.sep).join('/');
}

async function findSchemaCandidates(configuredPath: string): Promise<string[]> {
    const configured = configuredPath.trim();
    if (configured) {
        const resolvedConfigured = resolvePathAcrossWorkspaces(configured);
        return resolvedConfigured ? [resolvedConfigured] : [];
    }
    return findSchemaFiles();
}

async function resolveSchemaPath(configuredPath: string): Promise<string | undefined> {
    const configured = configuredPath.trim();
    if (configured) {
        const resolvedConfigured = resolvePathAcrossWorkspaces(configured);
        if (resolvedConfigured) {
            return resolvedConfigured;
        }
    }
    return findSchemaFile();
}

async function findSchemaFiles(): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const exclude = '**/{node_modules,cdk.out,dist,coverage,out,.git}/**';
    const seen = new Set<string>();
    const out: string[] = [];

    const pushUnique = (p: string) => {
        const normalized = path.normalize(p);
        if (seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        out.push(normalized);
    };

    // 1) Prefer segmented conventions by directory
    for (const folder of folders) {
        const segmented = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, 'lib/schemas/*.graphql'),
            exclude,
            200
        );
        const dirs = new Set(segmented.map(s => path.dirname(s.fsPath)));
        dirs.forEach(pushUnique);
    }

    // 2) Standard single-file schema
    for (const folder of folders) {
        const single = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/schema.graphql'),
            exclude,
            200
        );
        for (const s of single) {
            pushUnique(s.fsPath);
        }
    }

    // 3) Generic segmented schemas directory
    for (const folder of folders) {
        const segmented = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/schemas/*.graphql'),
            exclude,
            200
        );
        const dirs = new Set(segmented.map(s => path.dirname(s.fsPath)));
        dirs.forEach(pushUnique);
    }

    // 4) Fallback any .graphql
    const any = await vscode.workspace.findFiles('**/*.graphql', exclude, 200);
    for (const s of any) {
        pushUnique(s.fsPath);
    }

    return out;
}

async function findSchemaFile(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const exclude = '**/{node_modules,cdk.out,dist,coverage,out,.git}/**';

    for (const folder of folders) {
        const segmented = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, 'lib/schemas/*.graphql'),
            exclude,
            50
        );
        if (segmented.length > 0) {
            return path.dirname(segmented[0].fsPath);
        }
    }

    for (const folder of folders) {
        const single = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/schema.graphql'),
            exclude,
            10
        );
        if (single[0]?.fsPath) {
            return single[0].fsPath;
        }
    }

    for (const folder of folders) {
        const segmented = await vscode.workspace.findFiles(
            new vscode.RelativePattern(folder, '**/schemas/*.graphql'),
            exclude,
            50
        );
        if (segmented.length > 0) {
            return path.dirname(segmented[0].fsPath);
        }
    }

    const any = await vscode.workspace.findFiles('**/*.graphql', exclude, 20);
    if (any[0]?.fsPath) {
        return any[0].fsPath;
    }
    return undefined;
}

function findResolversDir(workspaceRoot: string, schemaPath: string, configuredPath: string): string | undefined {
    const configured = configuredPath.trim();
    if (configured) {
        const configuredResolved = resolvePathAcrossWorkspaces(configured, true);
        if (configuredResolved) {
            return configuredResolved;
        }
    }

    const schemaDir = fs.statSync(schemaPath).isDirectory() ? schemaPath : path.dirname(schemaPath);
    const candidates = [
        path.join(schemaDir, 'resolvers'),
        path.join(workspaceRoot, 'resolvers'),
        path.join(workspaceRoot, 'lib', 'resolvers'),
        path.join(workspaceRoot, 'appsync', 'resolvers'),
        path.join(workspaceRoot, 'generated', 'resolvers'),
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
        }
    }

    return undefined;
}

function findMockDataPath(workspaceRoot: string, schemaPath: string, configuredPath: string): string | undefined {
    const configured = configuredPath.trim();
    if (configured) {
        const configuredResolved = resolvePathAcrossWorkspaces(configured, false);
        if (configuredResolved) {
            return configuredResolved;
        }
    }

    const schemaDir = fs.statSync(schemaPath).isDirectory() ? schemaPath : path.dirname(schemaPath);
    const candidates = [
        path.join(schemaDir, 'mock-data.json'),
        path.join(workspaceRoot, 'mock-data.json'),
        path.join(workspaceRoot, 'test', 'mock-data.json'),
    ];

    return candidates.find(p => fs.existsSync(p));
}

function resolvePathAcrossWorkspaces(inputPath: string, expectDirectory?: boolean): string | undefined {
    if (path.isAbsolute(inputPath)) {
        if (!fs.existsSync(inputPath)) {
            return undefined;
        }
        const stat = fs.statSync(inputPath);
        if (expectDirectory === true && !stat.isDirectory()) {
            return undefined;
        }
        if (expectDirectory === false && !stat.isFile()) {
            return undefined;
        }
        return inputPath;
    }

    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        const candidate = path.join(folder.uri.fsPath, inputPath);
        if (!fs.existsSync(candidate)) {
            continue;
        }
        const stat = fs.statSync(candidate);
        if (expectDirectory === true && !stat.isDirectory()) {
            continue;
        }
        if (expectDirectory === false && !stat.isFile()) {
            continue;
        }
        return candidate;
    }

    return undefined;
}

function findWorkspaceRootForPath(targetPath: string): string | undefined {
    const folders = vscode.workspace.workspaceFolders ?? [];
    for (const folder of folders) {
        if (targetPath.startsWith(folder.uri.fsPath)) {
            return folder.uri.fsPath;
        }
    }
    return undefined;
}
