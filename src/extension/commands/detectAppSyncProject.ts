import * as vscode from 'vscode';
import { getConfig } from '../../shared/config';
import { pickAppSyncProject, toWorkspaceRelativePath } from './appsyncDiscovery';

export async function detectAppSyncProject(): Promise<void> {
    const discovered = await detectAndMaybeApplyAppSyncProject({ promptForApply: true });

    if (!discovered) {
        return;
    }

    vscode.window.showInformationMessage('Applied detected AppSync paths to workspace settings.');
}

export async function detectAndMaybeApplyAppSyncProject(
    options: { promptForApply: boolean }
) {
    const cfg = getConfig();
    const discovered = await pickAppSyncProject(cfg.appsync, {
        promptIfMultiple: true,
        quickPickTitle: 'Select AppSync project to detect',
    });

    if (!discovered) {
        vscode.window.showErrorMessage(
            'No AppSync schema detected. Set awsToolkit.appsync.schemaPath or ensure your project contains GraphQL schema files.'
        );
        return undefined;
    }

    const schemaDisplay = toWorkspaceRelativePath(discovered.workspaceRoot, discovered.schemaPath);
    const resolversDisplay = discovered.resolversDir
        ? toWorkspaceRelativePath(discovered.workspaceRoot, discovered.resolversDir)
        : '(not found)';
    const mockDisplay = discovered.mockDataPath
        ? toWorkspaceRelativePath(discovered.workspaceRoot, discovered.mockDataPath)
        : '(in-memory)';

    if (options.promptForApply) {
        const selection = await vscode.window.showInformationMessage(
            `Detected AppSync project — schema: ${schemaDisplay}, resolvers: ${resolversDisplay}, mock data: ${mockDisplay}`,
            'Apply detected settings',
            'Dismiss'
        );

        if (selection !== 'Apply detected settings') {
            return undefined;
        }
    }

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

    return discovered;
}
