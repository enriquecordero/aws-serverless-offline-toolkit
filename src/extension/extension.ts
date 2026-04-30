import * as vscode from 'vscode';
import { startAppSyncOffline, stopAppSyncOffline } from './commands/startAppSyncOffline';
import { detectAppSyncProject } from './commands/detectAppSyncProject';
import { detectAndStartAppSyncOffline } from './commands/detectAndStartAppSyncOffline';
import { validateAppSyncSetup } from './commands/validateAppSyncSetup';
import { runCdkDiffExplainer } from './commands/runCdkDiffExplainer';
import { synthAndValidateStackIntentCommand, validateStackIntentCommand } from './commands/validateStackIntent';
import { validateEnvVarsCommand } from './commands/validateEnvVars';
import { AppSyncPanel } from './webviews/appsyncPanel';

export function activate(context: vscode.ExtensionContext): void {
  console.log('[AWS Serverless Offline Toolkit] Activated');
  AppSyncPanel.setExtensionVersion(context.extension.packageJSON.version);
  AppSyncPanel.setExtensionUri(context.extensionUri);
  AppSyncPanel.setWorkspaceState(context.workspaceState);

  // ── AppSync Offline ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.startAppSyncOffline', startAppSyncOffline)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.stopAppSyncOffline', stopAppSyncOffline)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.detectAppSyncProject', detectAppSyncProject)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.detectAndStartAppSyncOffline', detectAndStartAppSyncOffline)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.validateAppSyncSetup', validateAppSyncSetup)
  );

  // ── CDK Diff Explainer ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.runCdkDiffExplainer', runCdkDiffExplainer)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.validateStackIntent', validateStackIntentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.synthAndValidateStackIntent', synthAndValidateStackIntentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('awsToolkit.validateEnvVars', validateEnvVarsCommand)
  );

  // ── Status bar buttons ───────────────────────────────────────────────────
  const appsyncButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  appsyncButton.command = 'awsToolkit.startAppSyncOffline';
  appsyncButton.text = '$(play) AppSync Local';
  appsyncButton.tooltip = 'Start AppSync Offline Server';
  appsyncButton.show();
  context.subscriptions.push(appsyncButton);

  const cdkDiffButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  cdkDiffButton.command = 'awsToolkit.runCdkDiffExplainer';
  cdkDiffButton.text = '$(diff) CDK Diff';
  cdkDiffButton.tooltip = 'Run CDK Diff Explainer';
  cdkDiffButton.show();
  context.subscriptions.push(cdkDiffButton);
}

export function deactivate(): void {
  stopAppSyncOffline();
  console.log('[AWS Serverless Offline Toolkit] Deactivated');
}
