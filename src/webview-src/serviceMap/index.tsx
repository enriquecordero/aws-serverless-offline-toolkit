import 'reactflow/dist/style.css';
import './styles.css';

import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeProps,
} from 'reactflow';

import type { MapEdge, MapNode, ServiceMap, ServiceNodeType } from './types';

const ICONS: Record<ServiceNodeType, string> = {
  appsync: '⬡',
  lambda: 'λ',
  dynamodb: '⬛',
  cognito: '👤',
  sqs: '📨',
  sns: '📢',
  eventbridge: '⚡',
  apigateway: '🌐',
  datasource: '◈',
};

const COL_ORDER: ServiceNodeType[] = [
  'cognito', 'apigateway', 'appsync', 'datasource',
  'lambda', 'dynamodb', 'sqs', 'sns', 'eventbridge',
];
const COL_W = 230;
const ROW_H = 130;

function layout(nodes: MapNode[]): Node[] {
  const groups: Record<string, MapNode[]> = {};
  COL_ORDER.forEach(t => { groups[t] = []; });
  nodes.forEach(n => {
    if (groups[n.type]) groups[n.type].push(n);
    else groups['lambda'].push(n);
  });
  const result: Node[] = [];
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

function buildEdges(mapEdges: MapEdge[]): Edge[] {
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
    labelBgStyle: { fill: '#1f2937', fillOpacity: 0.95 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
  }));
}

interface SvcNodeData {
  label: string;
  nt: ServiceNodeType;
  cfnType: string;
}

function SvcNode({ data }: NodeProps<SvcNodeData>) {
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

const LEGEND: { type: ServiceNodeType; color: string; label: string }[] = [
  { type: 'appsync', color: '#3b82f6', label: 'AppSync' },
  { type: 'lambda', color: '#f97316', label: 'Lambda' },
  { type: 'dynamodb', color: '#22c55e', label: 'DynamoDB' },
  { type: 'cognito', color: '#818cf8', label: 'Cognito' },
  { type: 'sqs', color: '#f59e0b', label: 'SQS' },
  { type: 'sns', color: '#ef4444', label: 'SNS' },
  { type: 'apigateway', color: '#06b6d4', label: 'API GW' },
  { type: 'eventbridge', color: '#a855f7', label: 'EventBridge' },
  { type: 'datasource', color: '#4b5563', label: 'DataSource' },
];

const NODE_COLORS: Record<ServiceNodeType, string> = {
  appsync: '#3b82f6', lambda: '#f97316', dynamodb: '#22c55e',
  cognito: '#818cf8', sqs: '#f59e0b', sns: '#ef4444',
  apigateway: '#06b6d4', eventbridge: '#a855f7', datasource: '#4b5563',
};

function FlowMap({ map }: { map: ServiceMap }) {
  const initNodes = useMemo(() => layout(map.nodes), [map]);
  const initEdges = useMemo(() => buildEdges(map.edges), [map]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  useEffect(() => {
    setNodes(layout(map.nodes));
    setEdges(buildEdges(map.edges));
  }, [map, setNodes, setEdges]);

  if (map.nodes.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 40 }}>🔍</div>
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
        nodeColor={n => NODE_COLORS[(n.data?.nt as ServiceNodeType)] ?? '#6b7280'}
        maskColor="rgba(0,0,0,.4)"
      />
    </ReactFlow>
  );
}

function App() {
  const maps = window.__MAPS__ ?? [];
  const [active, setActive] = useState(0);

  const typesPresent = useMemo(() => {
    const s = new Set(maps[active]?.nodes.map(n => n.type) ?? []);
    return LEGEND.filter(l => s.has(l.type));
  }, [active, maps]);

  return (
    <>
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
            <button
              key={i}
              className={'stack-tab' + (i === active ? ' active' : '')}
              onClick={() => setActive(i)}
            >
              {m.stackName}
            </button>
          ))}
        </div>
        <div className="legend">
          {typesPresent.map(l => (
            <div key={l.type} className="legend-item">
              <div className="legend-dot" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>
      <div className="map-wrap">
        <ReactFlowProvider>
          {maps[active] && <FlowMap key={active} map={maps[active]} />}
        </ReactFlowProvider>
      </div>
    </>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
