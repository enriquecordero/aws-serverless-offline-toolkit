import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AppSyncPanel } from '../webviews/appsyncPanel';
import { seedFromJsonFile, generateSkeletonsFromCdk } from '../../core/appsync/mockDataSeeder';
import { appSyncLogger } from '../../shared/logger';

function resolveMockDataPath(workspaceRoot: string): string | undefined {
    const config = vscode.workspace.getConfiguration('awsToolkit.appsync');
    const configured = config.get<string>('mockDataPath');
    if (configured) {
        return path.isAbsolute(configured) ? configured : path.join(workspaceRoot, configured);
    }
    const candidate = path.join(workspaceRoot, 'mock-data.json');
    return fs.existsSync(candidate) ? candidate : undefined;
}

export async function reloadMockDataCommand(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const root = folders[0].uri.fsPath;
    const mockDataPath = resolveMockDataPath(root);

    if (!mockDataPath) {
        vscode.window.showWarningMessage('No mock-data.json found. Configure awsToolkit.appsync.mockDataPath or place mock-data.json at the workspace root.');
        return;
    }

    appSyncLogger.info(`Reloading mock data from ${mockDataPath}...`);
    const { tables, itemCount } = seedFromJsonFile(mockDataPath);

    // Also reload on the running server if panel is active
    AppSyncPanel.currentPanel?.reloadMockData();

    if (tables.length === 0) {
        vscode.window.showWarningMessage('Mock data reloaded but no tables were found in the file.');
    } else {
        vscode.window.showInformationMessage(`Mock data reloaded: ${tables.length} table(s), ${itemCount} item(s).`);
    }

    appSyncLogger.info(`Mock data reloaded — tables: ${tables.join(', ')}, items: ${itemCount}`);
}

export async function seedFromCdkCommand(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const root = folders[0].uri.fsPath;
    const skeletons = generateSkeletonsFromCdk(root);
    const tableNames = Object.keys(skeletons);

    if (tableNames.length === 0) {
        vscode.window.showWarningMessage('No DynamoDB tables found in cdk.out. Run cdk synth first.');
        return;
    }

    // Write generated fixtures to mock-data.json (ask first if file exists)
    const outPath = path.join(root, 'mock-data.json');
    if (fs.existsSync(outPath)) {
        const action = await vscode.window.showWarningMessage(
            `mock-data.json already exists. Overwrite with CDK-generated skeletons?`,
            'Overwrite', 'Cancel'
        );
        if (action !== 'Overwrite') { return; }
    }

    fs.writeFileSync(outPath, JSON.stringify(skeletons, null, 2), 'utf8');
    appSyncLogger.info(`Generated mock-data.json with ${tableNames.length} table(s): ${tableNames.join(', ')}`);

    // Seed immediately
    seedFromJsonFile(outPath);
    AppSyncPanel.currentPanel?.reloadMockData();

    const doc = await vscode.workspace.openTextDocument(outPath);
    await vscode.window.showTextDocument(doc);
    vscode.window.showInformationMessage(`Generated mock-data.json with ${tableNames.length} table skeleton(s). Edit values and run Reload Mock Data to apply.`);
}
