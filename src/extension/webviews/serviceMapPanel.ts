import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseServiceMap, ServiceMap } from '../../core/cdk/serviceMapParser';

export class ServiceMapPanel {
  private static current: ServiceMapPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    panel.onDidDispose(() => { ServiceMapPanel.current = undefined; });
  }

  static async createOrShow(): Promise<void> {
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
        localResourceRoots: [],
      }
    );

    ServiceMapPanel.current = new ServiceMapPanel(panel);
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
    this.panel.webview.html = buildWebviewHtml(maps);
  }
}

function buildWebviewHtml(maps: ServiceMap[]): string {
  const mapsJson = JSON.stringify(maps);

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; img-src data: https:; connect-src 'none';"/>
<link rel="stylesheet" href="https://unpkg.com/reactflow@11/dist/style.css"/>
<script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
<script src="https://unpkg.com/reactflow@11/dist/umd/index.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#111827;color:#e5e7eb;font-family:-apple-system,'Segoe UI',system-ui,sans-serif;height:100vh;display:flex;flex-direction:column;overflow:hidden}
#root{flex:1;display:flex;flex-direction:column}
.toolbar{background:#1f2937;border-bottom:1px solid #374151;padding:8px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap}
.toolbar-title{font-size:13px;font-weight:700;color:#f9fafb;display:flex;align-items:center;gap:7px}
.toolbar-title svg{opacity:.7}
.stack-tabs{display:flex;gap:6px;flex-wrap:wrap}
.stack-tab{background:#374151;border:1px solid #4b5563;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:600;color:#9ca3af;cursor:pointer;transition:all .15s}
.stack-tab:hover{background:#4b5563;color:#e5e7eb}
.stack-tab.active{background:#1d4ed8;border-color:#3b82f6;color:#fff}
.legend{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}
.legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:#9ca3af}
.legend-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.map-wrap{flex:1;position:relative}
.empty-state{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:#6b7280;font-size:14px}

/* React Flow overrides */
.react-flow__background{background:#111827}
.react-flow__attribution{display:none}
.react-flow__edge-label-renderer .react-flow__edge-label{background:#1f2937;color:#9ca3af;font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid #374151}

/* Service nodes */
.svc-node{border-radius:10px;padding:10px 14px;min-width:130px;max-width:180px;text-align:center;border-width:2px;border-style:solid;cursor:grab;transition:box-shadow .15s;user-select:none}
.svc-node:hover{box-shadow:0 0 0 2px rgba(255,255,255,.15)}
.svc-icon{font-size:22px;line-height:1;margin-bottom:5px}
.svc-label{font-size:12px;font-weight:600;color:#f3f4f6;word-break:break-word;line-height:1.3}
.svc-type{font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-top:4px;opacity:.6}

.n-appsync   {background:#0f2a4a;border-color:#3b82f6}
.n-lambda    {background:#2d1500;border-color:#f97316}
.n-dynamodb  {background:#052e16;border-color:#22c55e}
.n-cognito   {background:#1e1b4b;border-color:#818cf8}
.n-sqs       {background:#2d1f00;border-color:#f59e0b}
.n-sns       {background:#2d0a0a;border-color:#ef4444}
.n-eventbridge{background:#1a0d3d;border-color:#a855f7}
.n-apigateway{background:#0a2230;border-color:#06b6d4}
.n-datasource{background:#1a1f2e;border-color:#4b5563;border-style:dashed}
</style>
</head>
<body>
<div id="root"></div>
<script>window.__MAPS__=${mapsJson};</script>
<script type="text/babel" data-presets="react">
const {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  MarkerType, Handle, Position,
  useReactFlow, ReactFlowProvider,
} = window.ReactFlow;

const { useState, useEffect, useCallback, useMemo } = React;

const ICONS = {
  appsync:    '⬡',
  lambda:     'λ',
  dynamodb:   '⬛',
  cognito:    '👤',
  sqs:        '📨',
  sns:        '📢',
  eventbridge:'⚡',
  apigateway: '🌐',
  datasource: '◈',
};

const COL_ORDER = ['cognito','apigateway','appsync','datasource','lambda','dynamodb','sqs','sns','eventbridge'];
const COL_W = 230;
const ROW_H = 130;

function layout(nodes) {
  const groups = {};
  COL_ORDER.forEach(t => { groups[t] = []; });
  nodes.forEach(n => {
    if (groups[n.type]) groups[n.type].push(n);
    else groups['lambda'].push(n);
  });
  const result = [];
  let col = 0;
  for (const type of COL_ORDER) {
    const items = groups[type];
    if (!items || items.length === 0) continue;
    items.forEach((n, row) => {
      result.push({
        id: n.id,
        type: 'svc',
        position: { x: 60 + col * COL_W, y: 40 + row * ROW_H },
        data: { label: n.label, nt: n.type, cfnType: n.cfnType },
      });
    });
    col++;
  }
  return result;
}

function buildEdges(mapEdges) {
  return mapEdges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: 'smoothstep',
    animated: e.label === 'triggers' || e.label === 'invokes',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#6b7280', width: 14, height: 14 },
    style: { stroke: '#4b5563', strokeWidth: 1.5 },
    labelStyle: { fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' },
    labelBgStyle: { fill: '#1f2937', fillOpacity: .95 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
  }));
}

function SvcNode({ data }) {
  return (
    <div className={'svc-node n-' + data.nt}>
      <Handle type="target" position={Position.Left} style={{ background: '#6b7280', border: 'none', width: 6, height: 6 }} />
      <div className="svc-icon">{ICONS[data.nt] ?? '⬡'}</div>
      <div className="svc-label">{data.label}</div>
      <div className="svc-type">{data.nt}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#6b7280', border: 'none', width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes = { svc: SvcNode };

const LEGEND = [
  { type:'appsync', color:'#3b82f6', label:'AppSync' },
  { type:'lambda',  color:'#f97316', label:'Lambda' },
  { type:'dynamodb',color:'#22c55e', label:'DynamoDB' },
  { type:'cognito', color:'#818cf8', label:'Cognito' },
  { type:'sqs',     color:'#f59e0b', label:'SQS' },
  { type:'sns',     color:'#ef4444', label:'SNS' },
  { type:'apigateway',color:'#06b6d4',label:'API GW' },
  { type:'eventbridge',color:'#a855f7',label:'EventBridge' },
  { type:'datasource',color:'#4b5563',label:'DataSource' },
];

function FlowMap({ map }) {
  const initNodes = useMemo(() => layout(map.nodes), [map]);
  const initEdges = useMemo(() => buildEdges(map.edges), [map]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    setNodes(layout(map.nodes));
    setEdges(buildEdges(map.edges));
  }, [map]);

  if (map.nodes.length === 0) {
    return (
      <div className="empty-state">
        <div style={{fontSize:40}}>🔍</div>
        <div>No se detectaron servicios AWS en este stack</div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={2}
    >
      <Background color="#1f2937" gap={24} size={1} />
      <Controls style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
      <MiniMap
        style={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }}
        nodeColor={n => {
          const colors = { appsync:'#3b82f6', lambda:'#f97316', dynamodb:'#22c55e', cognito:'#818cf8', sqs:'#f59e0b', sns:'#ef4444', apigateway:'#06b6d4', eventbridge:'#a855f7', datasource:'#4b5563' };
          return colors[n.data?.nt] ?? '#6b7280';
        }}
        maskColor="rgba(0,0,0,.4)"
      />
    </ReactFlow>
  );
}

function App() {
  const maps = window.__MAPS__;
  const [active, setActive] = useState(0);

  const typesPresent = useMemo(() => {
    const s = new Set(maps[active]?.nodes.map(n => n.type) ?? []);
    return LEGEND.filter(l => s.has(l.type));
  }, [active, maps]);

  return (
    <div id="root">
      <div className="toolbar">
        <div className="toolbar-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8z"/>
            <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3.5A.5.5 0 0 1 7.5 8V4.5A.5.5 0 0 1 8 4z"/>
          </svg>
          AWS Service Map
        </div>
        <div className="stack-tabs">
          {maps.map((m, i) => (
            <button key={i} className={'stack-tab' + (i === active ? ' active' : '')} onClick={() => setActive(i)}>
              {m.stackName}
            </button>
          ))}
        </div>
        <div className="legend">
          {typesPresent.map(l => (
            <div key={l.type} className="legend-item">
              <div className="legend-dot" style={{ background: l.color }}/>
              {l.label}
            </div>
          ))}
        </div>
      </div>
      <div className="map-wrap">
        <ReactFlowProvider>
          <FlowMap key={active} map={maps[active]} />
        </ReactFlowProvider>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>`;
}
