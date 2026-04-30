import * as vscode from 'vscode';
import { detectAndMaybeApplyAppSyncProject } from './detectAppSyncProject';
import { startAppSyncOffline } from './startAppSyncOffline';

export async function detectAndStartAppSyncOffline(): Promise<void> {
    const discovered = await detectAndMaybeApplyAppSyncProject({ promptForApply: false });
    if (!discovered) {
        return;
    }

    vscode.window.showInformationMessage('Detected AppSync configuration and updated workspace settings. Starting offline server...');
    await startAppSyncOffline();
}
