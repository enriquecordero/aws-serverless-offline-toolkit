import * as vscode from 'vscode';
import { DiffSummary, RiskLevel } from '../../shared/types';
import { generateMarkdownReport } from '../../core/cdkDiff/markdownReport';

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#f85149',
  high: '#f0883e',
  medium: '#e3b341',
  low: '#56d364',
};

export class CdkDiffPanel {
  static currentPanel: CdkDiffPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => { CdkDiffPanel.currentPanel = undefined; });
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
  }

  static createOrShow(): CdkDiffPanel {
    const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (CdkDiffPanel.currentPanel) {
      CdkDiffPanel.currentPanel.panel.reveal(col);
      return CdkDiffPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'cdkDiffExplainer', 'CDK Diff Explainer',
      col, { enableScripts: true, retainContextWhenHidden: true }
    );
    CdkDiffPanel.currentPanel = new CdkDiffPanel(panel);
    CdkDiffPanel.currentPanel.showLoading();
    return CdkDiffPanel.currentPanel;
  }

  showLoading(): void {
    this.panel.webview.html = this.loadingHtml();
  }

  showSummary(summary: DiffSummary): void {
    this.panel.webview.html = this.buildHtml(summary);
  }

  showError(message: string): void {
    this.panel.webview.html = `<!DOCTYPE html><html><body style="background:#0d1117;color:#f85149;font-family:monospace;padding:24px;">
      <h2>❌ CDK Diff Failed</h2><pre style="margin-top:12px;color:#c9d1d9;">${message}</pre>
    </body></html>`;
  }

  private handleMessage(msg: { type: string; [k: string]: unknown }): void {
    if (msg.type === 'exportMarkdown') {
      // raw markdown passed from webview
      const md = msg.markdown as string;
      vscode.workspace.openTextDocument({ language: 'markdown', content: md })
        .then(doc => vscode.window.showTextDocument(doc));
    }
  }

  private loadingHtml(): string {
    return `<!DOCTYPE html><html><body style="background:#0d1117;color:#c9d1d9;font-family:sans-serif;padding:24px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:24px;animation:spin 1s linear infinite;display:inline-block;">⚙️</span>
      <span>Running cdk diff...</span>
      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    </body></html>`;
  }

  private buildHtml(s: DiffSummary): string {
    const riskColor = RISK_COLOR[s.highestRisk];
    const changeRow = (c: { resourceType: string; logicalId: string; riskLevel: RiskLevel; explanation: string; recommendation?: string }) =>
      `<tr>
        <td><code>${c.resourceType}</code></td>
        <td>${c.logicalId}</td>
        <td><span class="badge" style="background:${RISK_COLOR[c.riskLevel]}20;color:${RISK_COLOR[c.riskLevel]};border:1px solid ${RISK_COLOR[c.riskLevel]}40">${c.riskLevel.toUpperCase()}</span></td>
        <td class="explain">${c.explanation}</td>
      </tr>`;

    const allChanges = [...s.added, ...s.modified, ...s.deleted, ...s.replaced];
    const critical = allChanges.filter(c => c.riskLevel === 'critical' || c.riskLevel === 'high');

    const markdownEscaped = JSON.stringify(generateMarkdownReport(s));

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>CDK Diff Explainer</title>
  <style>
    :root { --bg:#0d1117; --surface:#161b22; --border:#30363d; --text:#c9d1d9; --muted:#8b949e; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; padding: 0; }
    .header { background:var(--surface); border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; gap:12px; }
    .header h1 { font-size:15px; font-weight:700; }
    .risk-badge { padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; color:#fff; background:${riskColor}; margin-left:auto; }
    .main { padding:24px; max-width:1100px; }
    .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:24px; }
    .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:16px; text-align:center; }
    .stat-card .num { font-size:28px; font-weight:700; }
    .stat-card .label { font-size:11px; color:var(--muted); margin-top:4px; }
    .section { margin-bottom:24px; }
    .section h2 { font-size:13px; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:10px; padding-bottom:6px; border-bottom:1px solid var(--border); }
    table { width:100%; border-collapse:collapse; }
    th { text-align:left; padding:8px 10px; font-size:11px; color:var(--muted); border-bottom:1px solid var(--border); }
    td { padding:8px 10px; border-bottom:1px solid var(--border)20; vertical-align:top; }
    td code { background:#161b22; padding:2px 5px; border-radius:3px; font-size:11px; }
    .badge { padding:2px 8px; border-radius:4px; font-size:10px; font-weight:700; white-space:nowrap; }
    .explain { color:var(--muted); font-size:12px; }
    .findings { background:#1f1f1f; border:1px solid ${riskColor}40; border-radius:8px; padding:16px; margin-bottom:24px; }
    .findings h2 { color:${riskColor}; margin-bottom:12px; }
    .finding-item { margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--border); }
    .finding-item:last-child { margin-bottom:0; padding-bottom:0; border:none; }
    .finding-title { font-weight:600; margin-bottom:4px; }
    .finding-reco { background:#0d2818; border-left:3px solid #56d364; padding:6px 10px; margin-top:6px; font-size:12px; color:#56d364; border-radius:0 4px 4px 0; }
    .actions { display:flex; gap:8px; margin-bottom:20px; }
    button { background:#21262d; color:var(--text); border:1px solid var(--border); padding:7px 14px; border-radius:6px; font-size:12px; cursor:pointer; }
    button:hover { background:#30363d; }
    button.primary { background:#238636; border-color:#2ea043; color:#fff; }
    details summary { cursor:pointer; color:var(--muted); font-size:12px; padding:8px 0; }
    pre { background:var(--surface); padding:12px; border-radius:6px; font-size:11px; overflow-x:auto; color:var(--muted); margin-top:8px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🔍 CDK Diff Explainer</h1>
    ${s.stackName ? `<span style="color:var(--muted);font-size:12px;">Stack: <code>${s.stackName}</code></span>` : ''}
    <div class="risk-badge">${s.highestRisk.toUpperCase()} RISK</div>
  </div>

  <div class="main">
    <div class="actions">
      <button class="primary" onclick="exportMarkdown()">📄 Export Markdown Report</button>
      <span style="color:var(--muted);font-size:12px;align-self:center;">${new Date(s.timestamp).toLocaleString()}</span>
    </div>

    <div class="summary-grid">
      <div class="stat-card"><div class="num" style="color:#56d364">${s.added.length}</div><div class="label">✅ Added</div></div>
      <div class="stat-card"><div class="num" style="color:#79c0ff">${s.modified.length}</div><div class="label">✏️ Modified</div></div>
      <div class="stat-card"><div class="num" style="color:#f85149">${s.deleted.length}</div><div class="label">🗑️ Deleted</div></div>
      <div class="stat-card"><div class="num" style="color:#f0883e">${s.replaced.length}</div><div class="label">♻️ Replaced</div></div>
    </div>

    ${critical.length > 0 ? `
    <div class="findings">
      <h2>⚠️ Critical & High Risk Findings</h2>
      ${critical.map(c => `
      <div class="finding-item">
        <div class="finding-title"><span class="badge" style="background:${RISK_COLOR[c.riskLevel]}20;color:${RISK_COLOR[c.riskLevel]};border:1px solid ${RISK_COLOR[c.riskLevel]}40;margin-right:6px;">${c.riskLevel.toUpperCase()}</span>${c.logicalId}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:3px;">${c.explanation}</div>
        ${c.recommendation ? `<div class="finding-reco">💡 ${c.recommendation}</div>` : ''}
      </div>
      `).join('')}
    </div>
    ` : ''}

    ${allChanges.length > 0 ? `
    <div class="section">
      <h2>All Changes (${allChanges.length})</h2>
      <table>
        <thead><tr><th>Resource Type</th><th>Logical ID</th><th>Risk</th><th>Summary</th></tr></thead>
        <tbody>${allChanges.map(changeRow).join('')}</tbody>
      </table>
    </div>
    ` : '<div style="color:var(--muted);padding:24px;text-align:center;">No infrastructure changes detected.</div>'}

    ${s.recommendations.length > 0 ? `
    <div class="section">
      <h2>✅ Recommendations</h2>
      <ul style="padding-left:16px;line-height:1.8;color:var(--muted);">
        ${s.recommendations.map(r => `<li>${r}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    <details>
      <summary>📄 Raw CDK Diff Output</summary>
      <pre>${s.rawOutput.replace(/</g, '&lt;')}</pre>
    </details>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const markdown = ${markdownEscaped};
    function exportMarkdown() {
      vscode.postMessage({ type: 'exportMarkdown', markdown });
    }
  </script>
</body>
</html>`;
  }
}
