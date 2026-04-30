import * as vscode from 'vscode';
import { AppSyncOfflineServer } from '../../core/appsync/server';
import { AppSyncPanel } from '../webviews/appsyncPanel';
import { getConfig } from '../../shared/config';
import { appSyncLogger } from '../../shared/logger';
import { pickAppSyncProject } from './appsyncDiscovery';

let activeServer: AppSyncOfflineServer | undefined;

export async function startAppSyncOffline(): Promise<void> {
  if (activeServer) {
    vscode.window.showWarningMessage('AppSync Offline server is already running.');
    AppSyncPanel.createOrShow();
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  const cfg = getConfig();
  const discovered = await pickAppSyncProject(cfg.appsync, {
    promptIfMultiple: true,
    quickPickTitle: 'Select AppSync project to start',
  });
  if (!discovered) {
    vscode.window.showErrorMessage(
      'No GraphQL schema found. Configure awsToolkit.appsync.schemaPath or ensure your workspace contains GraphQL schema files.'
    );
    return;
  }

  const panel = AppSyncPanel.createOrShow(undefined, discovered.workspaceRoot);

  try {
    const server = new AppSyncOfflineServer({
      port: cfg.appsync.port,
      schemaPath: discovered.schemaPath,
      resolversDir: discovered.resolversDir,
      dataSources: discovered.dataSources,
      identity: { type: cfg.appsync.mockIdentity },
    });

    await server.start();
    activeServer = server;

    panel.attachServer(server);
    server.onSchemaReload(sdl => panel.notifySchemaReload(sdl));

    appSyncLogger.show();
    appSyncLogger.info(`Server started on port ${cfg.appsync.port}`);
    appSyncLogger.info(`Schema: ${discovered.schemaPath}`);
    appSyncLogger.info(`Resolvers: ${discovered.resolversDir ?? 'fallback to resolver-definitions.ts when available'}`);

    vscode.window.showInformationMessage(
      `AppSync Offline running at http://localhost:${cfg.appsync.port}/graphql`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appSyncLogger.error('Failed to start server', err);
    vscode.window.showErrorMessage(`Failed to start AppSync Offline: ${msg}`);
    activeServer = undefined;
  }
}

export function stopAppSyncOffline(): void {
  if (!activeServer) {
    vscode.window.showInformationMessage('No server is running.');
    return;
  }
  activeServer.stop();
  activeServer = undefined;
  vscode.window.showInformationMessage('AppSync Offline server stopped.');
}
