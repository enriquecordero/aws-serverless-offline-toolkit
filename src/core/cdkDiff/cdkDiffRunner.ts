import { execSync, ExecSyncOptions } from 'child_process';
import * as vscode from 'vscode';
import { cdkDiffLogger } from '../../shared/logger';

export interface CdkDiffRunnerResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export async function runCdkDiff(stackName?: string): Promise<CdkDiffRunnerResult> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;

  if (!workspaceRoot) {
    throw new Error('No workspace folder open. Please open a CDK project folder.');
  }

  const cmd = stackName
    ? `npx cdk diff ${stackName}`
    : `npx cdk diff`;

  cdkDiffLogger.info(`Running: ${cmd}`);
  cdkDiffLogger.info(`Working directory: ${workspaceRoot}`);

  const start = Date.now();
  let output = '';
  let exitCode = 0;

  const opts: ExecSyncOptions = {
    cwd: workspaceRoot,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024, // 10MB
    // CDK diff exits with 1 when there ARE changes (not an error), 0 when no changes
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  try {
    output = execSync(cmd, opts) as unknown as string;
  } catch (err: unknown) {
    // cdk diff exits 1 when changes exist — capture output anyway
    if (err && typeof err === 'object' && 'stdout' in err) {
      const e = err as { stdout: Buffer | string; stderr: Buffer | string; status: number };
      output = e.stdout?.toString() ?? '';
      if (e.stderr) {
        output += '\n' + e.stderr.toString();
      }
      exitCode = e.status ?? 1;
      // exit 1 = changes found (normal), not an error
      if (exitCode > 1) {
        cdkDiffLogger.error(`cdk diff failed with exit code ${exitCode}`);
        throw new Error(`cdk diff failed (exit ${exitCode}). Is CDK installed and the project bootstrapped?`);
      }
    } else {
      throw err;
    }
  }

  const durationMs = Date.now() - start;
  cdkDiffLogger.info(`cdk diff completed in ${durationMs}ms (exit ${exitCode})`);

  return { output, exitCode, durationMs };
}
