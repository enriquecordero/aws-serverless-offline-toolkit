import * as vscode from 'vscode';
import { EnvVarSummary, LambdaEnvReport, EnvVarEntry, VarStatus } from '../../core/cdkIntent/envVarValidator';

const STATUS_COLOR: Record<VarStatus, string> = {
  resolved:             '#56d364',
  resolved_local:       '#79c0ff',
  intrinsic:            '#8b949e',
  unresolvable_offline: '#e3b341',
  empty:                '#f85149',
};

const STATUS_ICON: Record<VarStatus, string> = {
  resolved:             '✅',
  resolved_local:       '📁',
  intrinsic:            '🔗',
  unresolvable_offline: '⚠️',
  empty:                '❌',
};

const STATUS_LABEL: Record<VarStatus, string> = {
  resolved:             'Resolved',
  resolved_local:       'Local Override',
  intrinsic:            'CDK Token',
  unresolvable_offline: 'Needs Cloud',
  empty:                'Empty',
};

const SOURCE_LABEL: Record<string, string> = {
  static:          'Static',
  ssm:             'SSM Parameter',
  secrets_manager: 'Secrets Manager',
  cross_stack_ref: 'Cross-stack Ref',
  intrinsic:       'CDK Intrinsic',
  empty:           'Empty',
};

export class EnvVarPanel {
  static currentPanel: EnvVarPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => { EnvVarPanel.currentPanel = undefined; });
  }

  static createOrShow(): EnvVarPanel {
    const col = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    if (EnvVarPanel.currentPanel) {
      EnvVarPanel.currentPanel.panel.reveal(col);
      return EnvVarPanel.currentPanel;
    }
    const panel = vscode.window.createWebviewPanel(
      'envVarReport', 'Env Var Preflight',
      col, { enableScripts: true, retainContextWhenHidden: true }
    );
    EnvVarPanel.currentPanel = new EnvVarPanel(panel);
    EnvVarPanel.currentPanel.showLoading();
    return EnvVarPanel.currentPanel;
  }

  showLoading(): void {
    this.panel.webview.html = `<!DOCTYPE html><html><body style="background:#0d1117;color:#c9d1d9;font-family:sans-serif;padding:32px;display:flex;align-items:center;gap:12px;">
      <span style="font-size:24px;animation:spin 1s linear infinite;display:inline-block;">⚙️</span>
      <span>Scanning Lambda environment variables...</span>
      <style>@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}</style>
    </body></html>`;
  }

  showReport(summary: EnvVarSummary): void {
    this.panel.webview.html = this.buildHtml(summary);
  }

  private varRow(v: EnvVarEntry): string {
    const color = STATUS_COLOR[v.status];
    const truncated = v.rawValue.length > 80 ? v.rawValue.slice(0, 77) + '...' : v.rawValue;
    const displayValue = v.localOverride !== undefined
      ? `<span style="color:#79c0ff;">${v.localOverride}</span> <span style="color:#8b949e;font-size:10px;">(from .env.local)</span>`
      : truncated
        ? `<span style="color:#8b949e;font-size:11px;">${truncated}</span>`
        : '<span style="color:#f85149;font-size:11px;font-style:italic;">empty</span>';

    return `
      <tr>
        <td style="font-family:monospace;font-size:12px;">${v.name}</td>
        <td><span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40;">${STATUS_ICON[v.status]} ${STATUS_LABEL[v.status]}</span></td>
        <td style="color:#8b949e;font-size:11px;">${SOURCE_LABEL[v.sourceType] ?? v.sourceType}</td>
        <td style="font-size:11px;">${displayValue}</td>
      </tr>`;
  }

  private lambdaCard(l: LambdaEnvReport, index: number): string {
    const hasAttention = l.attentionCount > 0;
    const borderColor = hasAttention ? '#e3b341' : '#30363d';
    const label = l.functionName ?? l.logicalId;
    const ssmVars = l.variables.filter(v => v.status === 'unresolvable_offline');

    return `
    <details ${index === 0 ? 'open' : ''} class="lambda-card" style="border:1px solid ${borderColor};">
      <summary>
        <span class="lambda-name">${label}</span>
        <span style="color:#8b949e;font-size:11px;margin-left:8px;">${l.stackName}</span>
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          ${hasAttention ? `<span class="count-badge" style="background:#e3b34120;color:#e3b341;">${l.attentionCount} need attention</span>` : ''}
          <span style="color:#8b949e;font-size:11px;">${l.variables.length} var${l.variables.length !== 1 ? 's' : ''}</span>
        </span>
      </summary>

      ${l.variables.length === 0 ? '<p class="no-vars">No environment variables declared.</p>' : `
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Source</th><th>Value</th></tr></thead>
        <tbody>${l.variables.map(v => this.varRow(v)).join('')}</tbody>
      </table>
      `}

      ${ssmVars.length > 0 ? `
      <div class="hint">
        💡 Add these to <code>.env.local</code> for offline validation:
        <pre>${ssmVars.map(v => `${v.name}=your-value-here`).join('\n')}</pre>
      </div>` : ''}
    </details>`;
  }

  private buildHtml(s: EnvVarSummary): string {
    const noLambdas = s.lambdasScanned === 0;

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Env Var Preflight</title>
  <style>
    :root { --bg:#0d1117; --surface:#161b22; --border:#30363d; --text:#c9d1d9; --muted:#8b949e; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; font-size:13px; }
    .header { background:var(--surface); border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; gap:12px; }
    .header h1 { font-size:15px; font-weight:700; }
    .main { padding:24px; max-width:960px; }
    .stats-row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px; }
    .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:16px; text-align:center; }
    .stat-card .num { font-size:28px; font-weight:700; }
    .stat-card .lbl { font-size:11px; color:var(--muted); margin-top:4px; }
    .legend { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:20px; }
    .legend-item { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--muted); }
    .legend-dot { width:8px; height:8px; border-radius:50%; }
    .lambda-card { background:var(--surface); border-radius:8px; margin-bottom:12px; overflow:hidden; }
    .lambda-card summary { display:flex; align-items:center; gap:8px; padding:12px 16px; cursor:pointer; list-style:none; user-select:none; }
    .lambda-card summary:hover { background:#1f2937; }
    .lambda-name { font-weight:600; font-size:13px; font-family:monospace; }
    .count-badge { padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600; }
    table { width:100%; border-collapse:collapse; margin:0 16px 16px; width:calc(100% - 32px); }
    th { text-align:left; padding:6px 10px; font-size:11px; color:var(--muted); border-bottom:1px solid var(--border); }
    td { padding:7px 10px; border-bottom:1px solid #30363d30; vertical-align:middle; }
    .badge { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; white-space:nowrap; }
    .hint { margin:0 16px 16px; background:#1c1f26; border-left:3px solid #e3b341; border-radius:0 6px 6px 0; padding:10px 14px; font-size:12px; color:#e3b341; }
    .hint pre { margin-top:6px; background:#0d1117; padding:8px; border-radius:4px; color:#c9d1d9; font-size:11px; }
    .hint code { background:#0d1117; padding:1px 4px; border-radius:3px; font-size:11px; }
    .no-vars { padding:12px 16px 16px; color:var(--muted); font-size:12px; }
    .empty-state { text-align:center; padding:60px 24px; color:var(--muted); }
    .empty-state .icon { font-size:48px; margin-bottom:12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Env Var Preflight</h1>
    <span style="color:var(--muted);font-size:12px;margin-left:auto;">${new Date().toLocaleString()}</span>
  </div>

  <div class="main">
    ${noLambdas ? `
    <div class="empty-state">
      <div class="icon">🔍</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:6px;">No Lambda functions found</div>
      <div>Make sure <code>cdk.out</code> exists. Run <strong>AWS: Synth and Validate Stack Intent</strong> first.</div>
    </div>
    ` : `
    <div class="stats-row">
      <div class="stat-card">
        <div class="num">${s.lambdasScanned}</div>
        <div class="lbl">Lambda Functions</div>
      </div>
      <div class="stat-card">
        <div class="num">${s.totalVariables}</div>
        <div class="lbl">Variables Scanned</div>
      </div>
      <div class="stat-card">
        <div class="num" style="color:${s.attentionCount > 0 ? '#e3b341' : '#56d364'};">${s.attentionCount}</div>
        <div class="lbl">Need Attention</div>
      </div>
    </div>

    <div class="legend">
      <span class="legend-item"><span class="legend-dot" style="background:#56d364;"></span>Resolved — static value</span>
      <span class="legend-item"><span class="legend-dot" style="background:#79c0ff;"></span>Local Override — from .env.local</span>
      <span class="legend-item"><span class="legend-dot" style="background:#8b949e;"></span>CDK Token — resolved at deploy</span>
      <span class="legend-item"><span class="legend-dot" style="background:#e3b341;"></span>Needs Cloud — SSM / Secrets / Cross-stack</span>
      <span class="legend-item"><span class="legend-dot" style="background:#f85149;"></span>Empty — likely misconfiguration</span>
    </div>

    ${s.lambdas.map((l, i) => this.lambdaCard(l, i)).join('')}
    `}
  </div>
</body>
</html>`;
  }
}
