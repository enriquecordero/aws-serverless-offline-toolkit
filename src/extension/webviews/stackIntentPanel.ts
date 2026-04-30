import * as vscode from 'vscode';
import { StackIntentSummary, StackIntentFinding } from '../../core/cdkIntent/stackIntentValidator';
import { generateStackIntentMarkdown } from '../../core/cdkIntent/stackIntentMarkdown';

const SEVERITY_COLOR: Record<'high' | 'medium' | 'low', string> = {
  high: '#f85149',
  medium: '#e3b341',
  low: '#56d364',
};

function scoreColor(score: number): string {
  if (score >= 90) { return '#56d364'; }
  if (score >= 75) { return '#79c0ff'; }
  if (score >= 50) { return '#e3b341'; }
  if (score >= 25) { return '#f0883e'; }
  return '#f85149';
}

export class StackIntentPanel {
  static currentPanel: StackIntentPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => { StackIntentPanel.currentPanel = undefined; });
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
  }

  static createOrShow(): StackIntentPanel {
    const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (StackIntentPanel.currentPanel) {
      StackIntentPanel.currentPanel.panel.reveal(col);
      return StackIntentPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'stackIntentReport', 'CDK Preflight Report',
      col, { enableScripts: true, retainContextWhenHidden: true }
    );
    StackIntentPanel.currentPanel = new StackIntentPanel(panel);
    StackIntentPanel.currentPanel.showLoading();
    return StackIntentPanel.currentPanel;
  }

  showLoading(): void {
    this.panel.webview.html = `<!DOCTYPE html><html><body style="background:#0d1117;color:#c9d1d9;font-family:sans-serif;padding:32px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:24px;animation:spin 1s linear infinite;display:inline-block;">⚙️</span>
      <span>Validating stack intent...</span>
      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    </body></html>`;
  }

  showReport(summary: StackIntentSummary): void {
    this.panel.webview.html = this.buildHtml(summary);
  }

  showError(message: string): void {
    this.panel.webview.html = `<!DOCTYPE html><html><body style="background:#0d1117;color:#f85149;font-family:monospace;padding:24px;">
      <h2>CDK Preflight Failed</h2><pre style="margin-top:12px;color:#c9d1d9;">${message}</pre>
    </body></html>`;
  }

  private handleMessage(msg: { type: string; [k: string]: unknown }): void {
    if (msg.type === 'exportMarkdown') {
      const md = msg.markdown as string;
      vscode.workspace.openTextDocument({ language: 'markdown', content: md })
        .then(doc => vscode.window.showTextDocument(doc));
    }
  }

  private buildHtml(s: StackIntentSummary): string {
    const color = scoreColor(s.confidenceScore);
    const high = s.findings.filter(f => f.severity === 'high');
    const medium = s.findings.filter(f => f.severity === 'medium');
    const low = s.findings.filter(f => f.severity === 'low');

    const findingRow = (f: StackIntentFinding) => `
      <div class="finding-item">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span class="badge" style="background:${SEVERITY_COLOR[f.severity]}20;color:${SEVERITY_COLOR[f.severity]};border:1px solid ${SEVERITY_COLOR[f.severity]}40;">${f.severity.toUpperCase()}</span>
          <code style="font-size:11px;color:#79c0ff;">${f.code}</code>
          <span style="font-size:11px;color:#8b949e;margin-left:auto;">${f.stackName}</span>
        </div>
        <div style="font-size:12px;color:#c9d1d9;">${f.message}</div>
      </div>`;

    const section = (title: string, items: StackIntentFinding[], color: string) =>
      items.length === 0 ? '' : `
      <div class="section">
        <div class="section-header" style="border-left:3px solid ${color};">
          <span style="color:${color};">${title}</span>
          <span class="count-badge" style="background:${color}20;color:${color};">${items.length}</span>
        </div>
        <div class="findings-list">${items.map(findingRow).join('')}</div>
      </div>`;

    const markdownEscaped = JSON.stringify(generateStackIntentMarkdown(s));

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>CDK Preflight Report</title>
  <style>
    :root { --bg:#0d1117; --surface:#161b22; --border:#30363d; --text:#c9d1d9; --muted:#8b949e; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; }
    .header { background:var(--surface); border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; gap:12px; }
    .header h1 { font-size:15px; font-weight:700; }
    .main { padding:24px; max-width:900px; }
    .score-block { display:flex; align-items:center; gap:32px; background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:24px; margin-bottom:24px; }
    .score-circle { width:100px; height:100px; border-radius:50%; border:4px solid ${color}; display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0; }
    .score-num { font-size:32px; font-weight:800; color:${color}; line-height:1; }
    .score-pct { font-size:11px; color:var(--muted); }
    .score-meta h2 { font-size:18px; font-weight:700; color:${color}; margin-bottom:6px; }
    .score-meta p { font-size:12px; color:var(--muted); line-height:1.6; }
    .stats-row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px; }
    .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:16px; text-align:center; }
    .stat-card .num { font-size:24px; font-weight:700; }
    .stat-card .lbl { font-size:11px; color:var(--muted); margin-top:4px; }
    .section { margin-bottom:16px; }
    .section-header { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--surface); border-radius:6px; margin-bottom:8px; font-size:12px; font-weight:600; }
    .count-badge { padding:2px 8px; border-radius:10px; font-size:11px; font-weight:700; }
    .findings-list { display:flex; flex-direction:column; gap:1px; }
    .finding-item { background:var(--surface); border:1px solid var(--border); border-radius:6px; padding:12px 14px; }
    .badge { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; white-space:nowrap; }
    .clean { text-align:center; padding:40px; color:var(--muted); }
    .clean .icon { font-size:48px; margin-bottom:12px; }
    .actions { display:flex; gap:8px; margin-bottom:20px; }
    button { background:#21262d; color:var(--text); border:1px solid var(--border); padding:7px 14px; border-radius:6px; font-size:12px; cursor:pointer; }
    button:hover { background:#30363d; }
    button.primary { background:#238636; border-color:#2ea043; color:#fff; }
  </style>
</head>
<body>
  <div class="header">
    <h1>CDK Preflight Report</h1>
    <span style="color:var(--muted);font-size:12px;margin-left:auto;">${new Date().toLocaleString()}</span>
  </div>

  <div class="main">
    <div class="actions">
      <button class="primary" id="exportBtn">Export Markdown</button>
    </div>

    <div class="score-block">
      <div class="score-circle">
        <span class="score-num">${s.confidenceScore}</span>
        <span class="score-pct">/ 100</span>
      </div>
      <div class="score-meta">
        <h2>${s.confidenceLabel}</h2>
        <p>
          ${s.stacksScanned} stack${s.stacksScanned !== 1 ? 's' : ''} scanned &nbsp;·&nbsp;
          ${s.resourcesScanned} resource${s.resourcesScanned !== 1 ? 's' : ''} analyzed &nbsp;·&nbsp;
          ${s.findings.length} finding${s.findings.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <div class="num" style="color:#f85149;">${high.length}</div>
        <div class="lbl">High Severity</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#e3b341;">${medium.length}</div>
        <div class="lbl">Medium Severity</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:#56d364;">${low.length}</div>
        <div class="lbl">Low Severity</div>
      </div>
    </div>

    ${s.findings.length === 0 ? `
    <div class="clean">
      <div class="icon">✅</div>
      <div style="font-size:15px;font-weight:600;color:#56d364;margin-bottom:6px;">All checks passed</div>
      <div>No issues found in the synthesized stack templates.</div>
    </div>
    ` : `
    ${section('High Severity', high, '#f85149')}
    ${section('Medium Severity', medium, '#e3b341')}
    ${section('Low Severity', low, '#56d364')}
    `}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const markdown = ${markdownEscaped};
    document.getElementById('exportBtn').addEventListener('click', function() {
      vscode.postMessage({ type: 'exportMarkdown', markdown });
    });
  </script>
</body>
</html>`;
  }
}
