import * as vscode from 'vscode';
import * as fs from 'fs';
import { getConfig } from '../../shared/config';
import { appSyncLogger } from '../../shared/logger';
import { SchemaLoader } from '../../core/appsync/schemaLoader';
import { pickAppSyncProject, toWorkspaceRelativePath } from './appsyncDiscovery';

type ValidationLevel = 'ok' | 'warn' | 'error';

interface ValidationCheck {
    title: string;
    level: ValidationLevel;
    detail: string;
}

export async function validateAppSyncSetup(): Promise<void> {
    const cfg = getConfig();
    const discovered = await pickAppSyncProject(cfg.appsync, {
        promptIfMultiple: true,
        quickPickTitle: 'Select AppSync project to validate',
    });

    if (!discovered) {
        vscode.window.showErrorMessage(
            'Validation failed: No AppSync schema detected. Configure awsToolkit.appsync.schemaPath or add GraphQL schema files to workspace.'
        );
        return;
    }

    const checks: ValidationCheck[] = [];
    const loader = new SchemaLoader(discovered.schemaPath, discovered.resolversDir);

    checks.push({
        title: 'Schema path',
        level: 'ok',
        detail: toWorkspaceRelativePath(discovered.workspaceRoot, discovered.schemaPath),
    });

    try {
        const schema = loader.loadSchema();
        const typeCount = Object.keys(schema.getTypeMap()).length;
        checks.push({
            title: 'Schema parsing',
            level: 'ok',
            detail: `Schema parsed successfully (${typeCount} types).`,
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({
            title: 'Schema parsing',
            level: 'error',
            detail: msg,
        });
    }

    if (discovered.resolversDir) {
        checks.push({
            title: 'Resolvers path',
            level: 'ok',
            detail: toWorkspaceRelativePath(discovered.workspaceRoot, discovered.resolversDir),
        });
    } else {
        checks.push({
            title: 'Resolvers path',
            level: 'warn',
            detail: 'No resolvers directory detected. Fallback to resolver-definitions.ts may be used if present.',
        });
    }

    try {
        const resolvers = loader.loadResolvers();
        checks.push({
            title: 'Resolvers load',
            level: resolvers.length > 0 ? 'ok' : 'warn',
            detail: resolvers.length > 0
                ? `Loaded ${resolvers.length} resolver definitions.`
                : 'No resolvers loaded. Queries may rely on fallback behavior.',
        });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        checks.push({
            title: 'Resolvers load',
            level: 'error',
            detail: msg,
        });
    }

    if (discovered.mockDataPath) {
        const mockRel = toWorkspaceRelativePath(discovered.workspaceRoot, discovered.mockDataPath);
        try {
            const raw = fs.readFileSync(discovered.mockDataPath, 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            const isObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
            checks.push({
                title: 'Mock data JSON',
                level: isObject ? 'ok' : 'warn',
                detail: isObject
                    ? `${mockRel} is valid JSON object.`
                    : `${mockRel} is valid JSON but not an object map.`,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            checks.push({
                title: 'Mock data JSON',
                level: 'error',
                detail: `${mockRel} parse failed: ${msg}`,
            });
        }
    } else {
        checks.push({
            title: 'Mock data source',
            level: 'warn',
            detail: 'No mock-data.json detected. In-memory mock datasource will be used.',
        });
    }

    const hasError = checks.some(c => c.level === 'error');
    const hasWarn = checks.some(c => c.level === 'warn');
    const summary = hasError ? 'Validation failed' : hasWarn ? 'Validation completed with warnings' : 'Validation passed';

    appSyncLogger.show();
    appSyncLogger.info('AppSync setup validation report');
    appSyncLogger.info(`Workspace: ${discovered.workspaceRoot}`);
    for (const check of checks) {
        const prefix = check.level.toUpperCase();
        if (check.level === 'error') {
            appSyncLogger.error(`[${prefix}] ${check.title}: ${check.detail}`);
        } else if (check.level === 'warn') {
            appSyncLogger.warn(`[${prefix}] ${check.title}: ${check.detail}`);
        } else {
            appSyncLogger.info(`[${prefix}] ${check.title}: ${check.detail}`);
        }
    }

    const action = await vscode.window.showInformationMessage(
        `${summary}. See "AppSync Offline" output for details.`,
        'Show report',
        'Apply detected settings'
    );

    if (action === 'Show report') {
        appSyncLogger.show();
        return;
    }

    if (action === 'Apply detected settings') {
        const config = vscode.workspace.getConfiguration('awsToolkit');
        await config.update(
            'appsync.schemaPath',
            toWorkspaceRelativePath(discovered.workspaceRoot, discovered.schemaPath),
            vscode.ConfigurationTarget.Workspace
        );
        await config.update(
            'appsync.resolversPath',
            discovered.resolversDir ? toWorkspaceRelativePath(discovered.workspaceRoot, discovered.resolversDir) : '',
            vscode.ConfigurationTarget.Workspace
        );
        await config.update(
            'appsync.mockDataPath',
            discovered.mockDataPath ? toWorkspaceRelativePath(discovered.workspaceRoot, discovered.mockDataPath) : '',
            vscode.ConfigurationTarget.Workspace
        );
        vscode.window.showInformationMessage('Applied detected AppSync paths to workspace settings.');
    }
}
