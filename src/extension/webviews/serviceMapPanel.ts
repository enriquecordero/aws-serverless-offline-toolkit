import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseServiceMap, ServiceMap } from '../../core/cdk/serviceMapParser';

export class ServiceMapPanel {
  private static current: ServiceMapPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    panel.onDidDispose(() => { ServiceMapPanel.current = undefined; });
  }

  static async createOrShow(extensionUri: vscode.Uri): Promise<void> {
    const cdkOutDir = await ServiceMapPanel.findCdkOut();
    if (!cdkOutDir) {
      const choice = await vscode.window.showErrorMessage(
        'No se encontró cdk.out. Ejecuta cdk synth primero.',
        'Ejecutar cdk synth'
      );
      if (choice === 'Ejecutar cdk synth') {
        const terminal = vscode.window.createTerminal('CDK Synth');
        terminal.sendText('cdk synth');
        terminal.show();
      }
      return;
    }

    let maps: ServiceMap[];
    try {
      maps = parseServiceMap(cdkOutDir);
    } catch (e) {
      vscode.window.showErrorMessage(`Error leyendo cdk.out: ${e}`);
      return;
    }

    if (maps.length === 0) {
      vscode.window.showWarningMessage('No se encontraron servicios AWS en cdk.out. Verifica que cdk synth haya corrido correctamente.');
      return;
    }

    const webviewRoot = vscode.Uri.joinPath(extensionUri, 'out', 'webview');

    if (ServiceMapPanel.current) {
      ServiceMapPanel.current.panel.reveal(vscode.ViewColumn.One);
      ServiceMapPanel.current.render(maps);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'awsServiceMap',
      'AWS Service Map',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [webviewRoot],
      }
    );

    ServiceMapPanel.current = new ServiceMapPanel(panel, extensionUri);
    ServiceMapPanel.current.render(maps);
  }

  private static async findCdkOut(): Promise<string | undefined> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const p = path.join(folder.uri.fsPath, 'cdk.out');
      if (fs.existsSync(p)) return p;
    }
    return undefined;
  }

  private render(maps: ServiceMap[]) {
    this.panel.title = `AWS Service Map (${maps.length} stack${maps.length !== 1 ? 's' : ''})`;
    this.panel.webview.html = this.buildHtml(maps);
  }

  private buildHtml(maps: ServiceMap[]): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'serviceMap.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'serviceMap.css')
    );
    const nonce = crypto.randomBytes(16).toString('base64');
    const cspSource = webview.cspSource;
    const mapsJson = JSON.stringify(maps).replace(/</g, '\\u003c');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource}; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource}; connect-src 'none';"/>
<link rel="stylesheet" href="${styleUri}"/>
<title>AWS Service Map</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__MAPS__=${mapsJson};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
