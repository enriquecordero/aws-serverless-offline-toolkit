import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { validateStackIntent } from '../../core/cdkIntent/stackIntentValidator';
import { cdkDiffLogger } from '../../shared/logger';
import { StackIntentPanel } from '../webviews/stackIntentPanel';

const execAsync = promisify(exec);

function quoteForShell(input: string): string {
    return `'${input.replace(/'/g, `'\\''`)}'`;
}

async function promptAndRunCdkSynth(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<void> {
    if (workspaceFolders.length === 0) {
        return;
    }

    let selectedFolder: vscode.WorkspaceFolder | undefined;
    if (workspaceFolders.length === 1) {
        selectedFolder = workspaceFolders[0];
    } else {
        selectedFolder = await vscode.window.showWorkspaceFolderPick({
            placeHolder: 'Select workspace folder to run cdk synth',
        });
    }

    if (!selectedFolder) {
        return;
    }

    const terminal = vscode.window.createTerminal({ name: 'CDK Intent Validation' });
    terminal.show(true);
    terminal.sendText(`cd ${quoteForShell(selectedFolder.uri.fsPath)}`);
    terminal.sendText('npx cdk synth');
}

async function pickWorkspaceFolder(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    placeHolder: string
): Promise<vscode.WorkspaceFolder | undefined> {
    if (workspaceFolders.length === 0) {
        return undefined;
    }

    if (workspaceFolders.length === 1) {
        return workspaceFolders[0];
    }

    return vscode.window.showWorkspaceFolderPick({ placeHolder });
}

async function runCdkSynthInWorkspace(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    cdkDiffLogger.info(`Running cdk synth in ${workspaceFolder.uri.fsPath}`);
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Running cdk synth in ${workspaceFolder.name}...`,
            cancellable: false,
        },
        async () => {
            await execAsync('npx cdk synth', {
                cwd: workspaceFolder.uri.fsPath,
                maxBuffer: 10 * 1024 * 1024,
            });
        }
    );
}

async function showValidationReport(roots: string[]): Promise<ReturnType<typeof validateStackIntent>> {
    cdkDiffLogger.show();
    cdkDiffLogger.info('Running stack intent validation from cdk.out templates...');

    const panel = StackIntentPanel.createOrShow();
    const result = validateStackIntent(roots);
    cdkDiffLogger.info(`Intent validation scanned ${result.stacksScanned} stack(s), ${result.resourcesScanned} resource(s), ${result.findings.length} finding(s). Confidence: ${result.confidenceScore}/100 (${result.confidenceLabel}).`);
    panel.showReport(result);

    return result;
}

export async function validateStackIntentCommand(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const roots = workspaceFolders.map(folder => folder.uri.fsPath);
    const result = await showValidationReport(roots);

    const highCount = result.findings.filter(f => f.severity === 'high').length;
    if (result.stacksScanned === 0) {
        const action = await vscode.window.showWarningMessage(
            'No stack templates were scanned. Run cdk synth to generate cdk.out templates first.',
            'Run cdk synth',
            'Re-run validation'
        );

        if (action === 'Run cdk synth') {
            await promptAndRunCdkSynth(workspaceFolders);
            return;
        }

        if (action === 'Re-run validation') {
            await validateStackIntentCommand();
            return;
        }
        return;
    }

    if (highCount > 0) {
        vscode.window.showWarningMessage(`Stack intent validation found ${highCount} high-severity finding(s).`);
    } else {
        vscode.window.showInformationMessage(`Stack intent validation completed: ${result.findings.length} finding(s).`);
    }
}

export async function synthAndValidateStackIntentCommand(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const selectedFolder = await pickWorkspaceFolder(
        workspaceFolders,
        'Select workspace folder to run cdk synth and validate stack intent'
    );
    if (!selectedFolder) {
        return;
    }

    try {
        await runCdkSynthInWorkspace(selectedFolder);
        const result = await showValidationReport([selectedFolder.uri.fsPath]);
        const highCount = result.findings.filter(f => f.severity === 'high').length;
        if (highCount > 0) {
            vscode.window.showWarningMessage(`Synth and validate completed with ${highCount} high-severity finding(s).`);
        } else {
            vscode.window.showInformationMessage(`Synth and validate completed: ${result.findings.length} finding(s).`);
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        cdkDiffLogger.error('cdk synth failed before validation', err);
        vscode.window.showErrorMessage(`cdk synth failed: ${msg}`);
    }
}
