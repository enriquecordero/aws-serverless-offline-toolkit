import * as vscode from 'vscode';
import { runCdkDiff } from '../../core/cdkDiff/cdkDiffRunner';
import { parseCdkDiff } from '../../core/cdkDiff/cdkDiffParser';
import { CdkDiffPanel } from '../webviews/cdkDiffPanel';
import { getConfig } from '../../shared/config';
import { cdkDiffLogger } from '../../shared/logger';

export async function runCdkDiffExplainer(): Promise<void> {
  const cfg = getConfig();
  const panel = CdkDiffPanel.createOrShow();

  cdkDiffLogger.show();
  cdkDiffLogger.info('Starting CDK Diff Explainer...');

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Running cdk diff...',
      cancellable: false,
    },
    async () => {
      try {
        const result = await runCdkDiff(cfg.cdkDiff.stackName || undefined);
        const summary = parseCdkDiff(result.output, cfg.cdkDiff.stackName || undefined);

        cdkDiffLogger.info(`Found ${summary.totalChanges} changes. Highest risk: ${summary.highestRisk}`);

        panel.showSummary(summary);

        // Show status bar message
        const icon = summary.highestRisk === 'critical' ? '🚨'
          : summary.highestRisk === 'high' ? '🔴'
          : summary.highestRisk === 'medium' ? '🟡' : '🟢';

        vscode.window.showInformationMessage(
          `${icon} CDK Diff: ${summary.totalChanges} changes — Highest risk: ${summary.highestRisk.toUpperCase()}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        cdkDiffLogger.error('CDK Diff failed', err);
        panel.showError(msg);
        vscode.window.showErrorMessage(`CDK Diff failed: ${msg}`);
      }
    }
  );
}
