import * as vscode from 'vscode';

class Logger {
  private outputChannel: vscode.OutputChannel;

  constructor(name: string) {
    this.outputChannel = vscode.window.createOutputChannel(name);
  }

  info(msg: string): void {
    this.log('INFO', msg);
  }

  warn(msg: string): void {
    this.log('WARN', msg);
  }

  error(msg: string, err?: unknown): void {
    this.log('ERROR', msg);
    if (err instanceof Error) {
      this.log('ERROR', err.stack ?? err.message);
    }
  }

  show(): void {
    this.outputChannel.show(true);
  }

  private log(level: string, msg: string): void {
    const ts = new Date().toISOString();
    this.outputChannel.appendLine(`[${ts}] [${level}] ${msg}`);
  }
}

export const appSyncLogger = new Logger('AppSync Offline');
export const cdkDiffLogger = new Logger('CDK Diff Explainer');
