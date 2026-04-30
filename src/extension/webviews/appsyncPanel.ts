import * as vscode from 'vscode';
import { AppSyncOfflineServer } from '../../core/appsync/server';
import { ResolverLog } from '../../shared/types';
import { appSyncLogger } from '../../shared/logger';

export class AppSyncPanel {
  static currentPanel: AppSyncPanel | undefined;
  static extensionVersion = 'dev';
  static extensionUri: vscode.Uri | undefined;
  static workspaceState: vscode.Memento | undefined;
  private readonly panel: vscode.WebviewPanel;
  private server?: AppSyncOfflineServer;
  private logs: ResolverLog[] = [];
  private webviewReady = false;
  private workspaceKey = 'default';

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.panel.webview.html = this.buildHtml();
  }

  static createOrShow(server?: AppSyncOfflineServer, workspaceKey?: string): AppSyncPanel {
    const column = vscode.window.activeTextEditor?.viewColumn;
    if (AppSyncPanel.currentPanel) {
      if (workspaceKey) {
        AppSyncPanel.currentPanel.workspaceKey = workspaceKey;
      }
      AppSyncPanel.currentPanel.panel.reveal(column);
      AppSyncPanel.currentPanel.panel.webview.html = AppSyncPanel.currentPanel.buildHtml();
      AppSyncPanel.currentPanel.webviewReady = false;
      return AppSyncPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'appSyncOffline',
      'AppSync Offline Studio',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: AppSyncPanel.extensionUri
          ? [vscode.Uri.joinPath(AppSyncPanel.extensionUri, 'media')]
          : [],
      }
    );

    AppSyncPanel.currentPanel = new AppSyncPanel(panel);
    if (workspaceKey) {
      AppSyncPanel.currentPanel.workspaceKey = workspaceKey;
    }
    if (server) {
      AppSyncPanel.currentPanel.attachServer(server);
    }
    return AppSyncPanel.currentPanel;
  }

  static setExtensionVersion(version: string | undefined): void {
    AppSyncPanel.extensionVersion = version ?? 'dev';
    if (AppSyncPanel.currentPanel) {
      AppSyncPanel.currentPanel.panel.webview.html = AppSyncPanel.currentPanel.buildHtml();
    }
  }

  static setExtensionUri(uri: vscode.Uri): void {
    AppSyncPanel.extensionUri = uri;
  }

  static setWorkspaceState(state: vscode.Memento): void {
    AppSyncPanel.workspaceState = state;
  }

  attachServer(server: AppSyncOfflineServer): void {
    this.server = server;
    this.server.onLog(log => {
      this.logs.push(log);
      if (this.webviewReady) {
        this.panel.webview.postMessage({ type: 'log', log });
      }
    });
    this.pushServerState();
    // Guard against webview initialization race: replay once shortly after attach.
    setTimeout(() => this.pushServerState(), 150);
  }

  private handleMessage(msg: { type: string;[k: string]: unknown }): void {
    if (msg.type === 'ready') {
      this.webviewReady = true;
      this.pushPersistedState();
      this.pushServerState();
      return;
    }

    if (msg.type === 'requestState') {
      this.pushPersistedState();
      return;
    }

    if (msg.type === 'persistState' && msg.state && typeof msg.state === 'object') {
      void AppSyncPanel.workspaceState?.update(this.storageKey(), msg.state);
      return;
    }

    if (msg.type === 'clearLogs') {
      this.logs = [];
    }
  }

  dispose(): void {
    AppSyncPanel.currentPanel = undefined;
    this.panel.dispose();
  }

  notifySchemaReload(sdl: string): void {
    if (!this.webviewReady) {
      return;
    }
    this.panel.webview.postMessage({ type: 'schemaReloaded', schemaSDL: sdl });
  }

  private pushServerState(): void {
    if (!this.webviewReady || !this.server) {
      return;
    }
    this.panel.webview.postMessage({
      type: 'serverStarted',
      port: this.server.getPort(),
      schemaSDL: this.server.getSchemaSDL(),
    });

    for (const log of this.logs.slice(-100)) {
      this.panel.webview.postMessage({ type: 'log', log });
    }
  }

  private pushPersistedState(): void {
    if (!this.webviewReady) {
      return;
    }
    const saved = AppSyncPanel.workspaceState?.get<Record<string, unknown>>(this.storageKey());
    if (!saved) {
      return;
    }
    this.panel.webview.postMessage({
      type: 'hydrateState',
      state: saved,
    });
  }

  private storageKey(): string {
    return `appsync.offline.panelState.${encodeURIComponent(this.workspaceKey)}`;
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = AppSyncPanel.extensionUri
      ? webview.asWebviewUri(vscode.Uri.joinPath(AppSyncPanel.extensionUri, 'media', 'appsyncPanel.js'))
      : '';
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src ${webview.cspSource}; connect-src http://localhost:* https:;`;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>AppSync Offline Studio</title>
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --accent: #f78166;
      --accent2: #79c0ff;
      --text: #c9d1d9;
      --muted: #8b949e;
      --success: #56d364;
      --warning: #e3b341;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 13px; height: 100vh; display: flex; flex-direction: column; }
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 14px; font-weight: 600; color: var(--accent2); }
    .title-wrap { display: flex; align-items: center; gap: 8px; }
    .version-badge { font-size: 11px; color: var(--warning); border: 1px solid var(--border); background: #11161d; padding: 2px 8px; border-radius: 999px; }
    .status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-left: auto; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
    .dot.running { background: var(--success); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
    .container { display: flex; flex: 1; overflow: hidden; }
    .editor-pane { flex: 1; display: flex; flex-direction: column; border-right: 1px solid var(--border); }
    .logs-pane { width: 320px; display: flex; flex-direction: column; }
    .pane-header { padding: 8px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); background: var(--surface); border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
    .log-filters { display: flex; align-items: center; gap: 6px; }
    .log-filters select,
    .log-filters input {
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 4px;
      font-size: 10px;
      padding: 3px 6px;
      outline: none;
    }
    .log-filters input { width: 120px; }
    textarea { background: transparent; color: var(--text); caret-color: var(--text); border: none; padding: 12px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 13px; resize: none; outline: none; position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; }
    body.overlay-ready #queryInput { color: transparent; }
    .editor-stack { position: relative; flex: 1; background: #0d1117; min-height: 0; overflow: hidden; }
    .editor-highlight { position: absolute; inset: 0; overflow: auto; padding: 12px; font-family: 'Cascadia Code', 'JetBrains Mono', monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; color: var(--text); pointer-events: none; z-index: 1; margin: 0; }
    .kw-op { color: var(--accent2); font-weight: 700; }
    .kw-str { color: #a8ff78; }
    .editor-meta { padding: 6px 12px; background: #11161d; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; }
    .editor-hint { font-size: 11px; color: var(--muted); }
    .op-badge { font-size: 10px; border: 1px solid var(--border); background: #19212b; color: var(--accent2); border-radius: 999px; padding: 2px 8px; text-transform: uppercase; letter-spacing: 0.08em; }
    .actions { padding: 8px 12px; background: var(--surface); border-top: 1px solid var(--border); display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
    .editor-tabs { display: flex; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .editor-tab { padding: 7px 14px; border: none; background: transparent; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; border-bottom: 2px solid transparent; }
    .editor-tab.active { color: var(--accent2); border-bottom-color: var(--accent2); }
    .editor-panel { display: none; flex: 1; flex-direction: column; overflow: hidden; min-height: 0; }
    .editor-panel.active { display: flex; }
    .vars-hint { padding: 6px 12px; background: #11161d; border-bottom: 1px solid var(--border); font-size: 11px; color: var(--muted); flex-shrink: 0; }
    textarea.vars-input { position: static; background: #0d1117; color: var(--text); caret-color: var(--text); z-index: auto; flex: 1; height: auto; }
    .kbd { font-size: 10px; color: var(--muted); margin-left: 4px; }
    .history-wrap { position: relative; }
    .history-dropdown { position: absolute; bottom: calc(100% + 4px); left: 0; min-width: 360px; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; z-index: 100; max-height: 220px; overflow-y: auto; display: none; box-shadow: 0 4px 24px rgba(0,0,0,0.5); }
    .history-dropdown.open { display: block; }
    .history-item { padding: 8px 12px; font-size: 11px; color: var(--muted); font-family: monospace; cursor: pointer; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .history-item:hover { background: #1f2d3d; color: var(--text); }
    .history-empty { padding: 12px; font-size: 12px; color: var(--muted); text-align: center; }
    .response-error { color: var(--accent); }
    .schema-search { padding: 6px 8px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
    .schema-search input { width: 100%; background: #0d1117; border: 1px solid var(--border); color: var(--text); padding: 5px 8px; border-radius: 4px; font-size: 12px; outline: none; }
    .schema-search input:focus { border-color: var(--accent2); }
    .reload-badge { font-size: 10px; color: var(--success); margin-left: 8px; display: none; }
    .reload-badge.show { display: inline; animation: fadeOut 3s forwards; }
    @keyframes fadeOut { 0%,70% { opacity: 1; } 100% { opacity: 0; } }
    .schema-count { font-size: 10px; color: var(--muted); }
    button { background: var(--accent); color: #fff; border: none; padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; }
    button:hover { opacity: 0.85; }
    button.secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .response-pane { height: 200px; border-top: 1px solid var(--border); overflow: hidden; display: flex; flex-direction: column; flex-shrink: 0; }
    .response-pane pre { flex: 1; overflow: auto; }
    .pane-controls { display: flex; gap: 4px; }
    .pane-controls button { padding: 2px 8px; font-size: 10px; }
    pre { padding: 12px; font-family: 'Cascadia Code', monospace; font-size: 12px; white-space: pre-wrap; }
    .log-list { flex: 1; overflow-y: auto; }
    .log-item { padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .log-item .log-header { display: flex; gap: 6px; font-size: 11px; margin-bottom: 3px; }
    .log-item .field { color: var(--accent2); font-weight: 600; }
    .log-item .phase { padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; }
    .phase.request { background: #1f3a5f; color: #79c0ff; }
    .phase.response { background: #1f4a2a; color: #56d364; }
    .phase.error { background: #4a1f1f; color: #f78166; }
    .log-item .duration { color: var(--muted); margin-left: auto; }
    .log-body { font-family: monospace; font-size: 11px; color: var(--muted); }
    .server-banner { padding: 10px 12px; background: #1c2a1c; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--success); display: none; flex-shrink: 0; }
    .server-banner.visible { display: block; }
    .side-tabs { display: flex; flex-shrink: 0; }
    .side-tab { flex: 1; padding: 8px 10px; border: none; border-bottom: 2px solid transparent; background: var(--surface); color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; }
    .side-tab.active { color: var(--accent2); border-bottom-color: var(--accent2); }
    .side-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .side-panel { display: none; height: 100%; flex-direction: column; }
    .side-panel.active { display: flex; flex-direction: column; }
    .schema-view { flex: 1; overflow: auto; background: #0d1117; }
    .schema-view pre { color: var(--text); font-size: 11px; line-height: 1.6; }
    .schema-view .sdl-keyword { color: #ffb86c; font-weight: 700; }
    .schema-view .sdl-type { color: #79c0ff; font-weight: 600; }
    .schema-view .sdl-directive { color: #e3b341; }
    .schema-view .sdl-field { color: #c9d1d9; }
    .schema-view .sdl-comment { color: #6e7681; font-style: italic; }
    .autocomplete { position: absolute; z-index: 30; min-width: 220px; max-width: 420px; max-height: 220px; overflow-y: auto; background: #11161d; border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); display: none; }
    .autocomplete.open { display: block; }
    .autocomplete-item { padding: 6px 10px; font-size: 12px; display: flex; justify-content: space-between; gap: 8px; cursor: pointer; }
    .autocomplete-item:hover, .autocomplete-item.active { background: #1f2d3d; }
    .autocomplete-item .name { color: var(--text); font-family: 'Cascadia Code', 'JetBrains Mono', monospace; }
    .autocomplete-item .kind { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <header>
    <div class="title-wrap">
      <h1>⚡ AppSync Offline Studio</h1>
      <span class="version-badge">v${AppSyncPanel.extensionVersion}</span>
    </div>
    <div class="status">
      <div class="dot" id="statusDot"></div>
      <span id="statusText">Waiting for server...</span>
    </div>
  </header>

  <div class="server-banner" id="banner"></div>

  <div class="container">
    <div class="editor-pane">
      <div class="editor-tabs">
        <button id="tabEditorQuery" class="editor-tab active">Query</button>
        <button id="tabEditorVars" class="editor-tab">Variables</button>
      </div>

      <div id="editorPanelQuery" class="editor-panel active">
        <div class="editor-meta">
          <span class="editor-hint">Ctrl+Enter to run &nbsp;·&nbsp; Tab = indent &nbsp;·&nbsp; { ( [ auto-close</span>
          <span id="opBadge" class="op-badge">none</span>
        </div>
        <div class="editor-stack">
          <pre id="queryHighlight" class="editor-highlight"></pre>
          <textarea id="queryInput" spellcheck="false"
            placeholder="# Write your GraphQL query here&#10;query {&#10;  healthCheck {&#10;    status&#10;  }&#10;}"></textarea>
          <div id="autocomplete" class="autocomplete"></div>
        </div>
      </div>

      <div id="editorPanelVars" class="editor-panel">
        <div class="vars-hint">JSON variables — e.g. {&quot;id&quot;: &quot;usr-001&quot;}</div>
        <textarea id="variablesInput" class="vars-input" spellcheck="false" placeholder="{}"></textarea>
      </div>

      <div class="actions">
        <button id="btnRun">▶ Run <span class="kbd">⌃↵</span></button>
        <button id="btnClear" class="secondary">Clear</button>
        <div class="history-wrap">
          <button id="btnHistory" class="secondary">⏱ History</button>
          <div class="history-dropdown" id="historyDropdown"></div>
        </div>
      </div>

      <div class="response-pane" id="responsePane">
        <div class="pane-header">
          <span>Response</span>
          <div class="pane-controls">
            <button id="btnCopy" class="secondary">⎘ Copy</button>
            <button id="btnResizeUp" class="secondary">↑</button>
            <button id="btnResizeDown" class="secondary">↓</button>
            <button id="btnResetSize" class="secondary">⤢</button>
          </div>
        </div>
        <pre id="responseOutput">// Response will appear here</pre>
      </div>
    </div>

    <div class="logs-pane">
      <div class="side-tabs">
        <button id="tabLogs" class="side-tab active">Logs</button>
        <button id="tabSchema" class="side-tab">Schema</button>
      </div>
      <div class="side-content">
        <div id="panelLogs" class="side-panel active">
          <div class="pane-header">
            <span>Resolver Logs</span>
            <div class="log-filters">
              <select id="logPhaseFilter" title="Filter by phase">
                <option value="all">All</option>
                <option value="request">Request</option>
                <option value="response">Response</option>
                <option value="error">Error</option>
              </select>
              <input id="logSearch" type="text" placeholder="Type.field" title="Filter by resolver" />
              <button id="btnClearLogs" class="secondary" style="padding:2px 8px;font-size:10px;">Clear</button>
            </div>
          </div>
          <div class="log-list" id="logList">
            <div style="padding:16px;color:var(--muted);font-size:12px;">Logs will appear when resolvers execute.</div>
          </div>
        </div>
        <div id="panelSchema" class="side-panel">
          <div class="schema-search">
            <input type="text" id="schemaSearch" placeholder="Search types, fields..." />
          </div>
          <div class="pane-header" style="padding:6px 12px;">
            <span>Loaded Schema</span>
            <span id="reloadBadge" class="reload-badge">↻ reloaded</span>
            <span id="schemaCount" class="schema-count"></span>
          </div>
          <div class="schema-view">
            <pre id="schemaOutput">// Schema will appear when server starts</pre>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
