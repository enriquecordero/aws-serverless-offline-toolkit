import * as vscode from 'vscode';
import { validateEnvVars } from '../../core/cdkIntent/envVarValidator';
import { EnvVarPanel } from '../webviews/envVarPanel';
import { cdkDiffLogger } from '../../shared/logger';

export async function validateEnvVarsCommand(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
    }

    const panel = EnvVarPanel.createOrShow();
    const roots = workspaceFolders.map(f => f.uri.fsPath);

    cdkDiffLogger.show();
    cdkDiffLogger.info('Scanning Lambda environment variables from cdk.out templates...');

    const summary = validateEnvVars(roots);

    cdkDiffLogger.info(
        `Env var scan: ${summary.lambdasScanned} Lambda(s), ${summary.totalVariables} variable(s), ${summary.attentionCount} need attention.`
    );

    panel.showReport(summary);

    if (summary.lambdasScanned === 0) {
        const action = await vscode.window.showWarningMessage(
            'No Lambda functions found in cdk.out. Run cdk synth first.',
            'Run cdk synth'
        );
        if (action === 'Run cdk synth') {
            const terminal = vscode.window.createTerminal({ name: 'CDK Synth' });
            terminal.show(true);
            terminal.sendText(`cd '${workspaceFolders[0].uri.fsPath.replace(/'/g, "'\\''")}'`);
            terminal.sendText('npx cdk synth');
        }
        return;
    }

    if (summary.attentionCount > 0) {
        vscode.window.showWarningMessage(
            `Env var scan found ${summary.attentionCount} variable(s) that need attention. Add overrides to .env.local for offline validation.`
        );
    } else {
        vscode.window.showInformationMessage(
            `Env var scan complete: ${summary.totalVariables} variable(s) across ${summary.lambdasScanned} Lambda(s). No issues found.`
        );
    }
}
