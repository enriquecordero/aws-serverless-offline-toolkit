import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppSyncContext } from '../../shared/types';

export interface LambdaHandlerSpec {
  handlerPath: string;
  exportName: string;
}

export interface LambdaInvokeResult {
  result: unknown;
  durationMs: number;
  error?: string;
  logs: string[];
}

// ── Runner script written to disk on first use ────────────────────────────────

const RUNNER_SCRIPT = [
  "'use strict';",
  "const path = require('path'), fs = require('fs');",
  "const [,, eventPath, handlerPath, exportName = 'handler'] = process.argv;",
  "const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));",
  "const ctx = {",
  "  functionName: 'local-lambda', functionVersion: '$LATEST',",
  "  invokedFunctionArn: 'arn:aws:lambda:local:123456789012:function:local-lambda',",
  "  memoryLimitInMB: '512', awsRequestId: 'local-' + Date.now(),",
  "  logGroupName: '/aws/lambda/local-lambda',",
  "  logStreamName: new Date().toISOString().replace(/[:.]/g, '-'),",
  "  getRemainingTimeInMillis: () => 30000, callbackWaitsForEmptyEventLoop: false,",
  "  done: () => {}, fail: () => {}, succeed: () => {},",
  "};",
  "if (handlerPath.endsWith('.ts')) {",
  "  try { require('ts-node').register({ transpileOnly: true, skipProject: true }); }",
  "  catch (e) { process.stderr.write('[WARN] ts-node not available: ' + e.message + '\\n'); }",
  "}",
  "let mod;",
  "try { mod = require(path.resolve(handlerPath)); }",
  "catch (e) { process.stdout.write(JSON.stringify({ error: 'Load error: ' + e.message })); process.exit(0); }",
  "const fn = mod[exportName] || mod.default || mod;",
  "if (typeof fn !== 'function') {",
  "  process.stdout.write(JSON.stringify({ error: 'No export \"' + exportName + '\" found in ' + handlerPath }));",
  "  process.exit(0);",
  "}",
  "debugger;",
  "Promise.resolve(fn(event, ctx))",
  "  .then(r => { process.stdout.write(JSON.stringify({ result: r ?? null })); process.exit(0); })",
  "  .catch(e => { process.stdout.write(JSON.stringify({ error: e.message || String(e), stack: e.stack })); process.exit(0); });",
].join('\n');

let cachedRunnerPath: string | undefined;

function getRunnerScriptPath(): string {
  if (cachedRunnerPath && fs.existsSync(cachedRunnerPath)) {
    return cachedRunnerPath;
  }
  cachedRunnerPath = path.join(os.tmpdir(), 'appsync-lambda-runner.js');
  fs.writeFileSync(cachedRunnerPath, RUNNER_SCRIPT, 'utf8');
  return cachedRunnerPath;
}

// ── AppSync event builder ─────────────────────────────────────────────────────

export function buildAppSyncLambdaEvent(ctx: AppSyncContext): Record<string, unknown> {
  return {
    arguments: ctx.arguments,
    identity: ctx.identity,
    source: ctx.source,
    request: ctx.request,
    info: ctx.info,
    stash: ctx.stash,
    prev: ctx.prev ?? null,
  };
}

// ── Local invocation ──────────────────────────────────────────────────────────

export interface InvokeLambdaOpts {
  handlerSpec: LambdaHandlerSpec;
  event: Record<string, unknown>;
  workspaceRoot: string;
  debug?: boolean;
  debugPort?: number;
  timeoutMs?: number;
  onProcess?: (proc: cp.ChildProcess) => void;
}

export function invokeLambdaLocally(opts: InvokeLambdaOpts): Promise<LambdaInvokeResult> {
  const {
    handlerSpec,
    event,
    workspaceRoot,
    debug = false,
    debugPort = 9229,
    timeoutMs = debug ? 600000 : 30000,
    onProcess,
  } = opts;

  return new Promise((resolve) => {
    const runnerPath = getRunnerScriptPath();

    const eventFile = path.join(os.tmpdir(), `appsync-event-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(eventFile, JSON.stringify(event), 'utf8');

    const absoluteHandlerPath = path.isAbsolute(handlerSpec.handlerPath)
      ? handlerSpec.handlerPath
      : path.join(workspaceRoot, handlerSpec.handlerPath);

    const nodeArgs: string[] = [];
    if (debug) nodeArgs.push(`--inspect-brk=${debugPort}`);
    nodeArgs.push(runnerPath, eventFile, absoluteHandlerPath, handlerSpec.exportName);

    const start = Date.now();
    const proc = cp.spawn('node', nodeArgs, {
      cwd: workspaceRoot,
      env: { ...process.env, NODE_PATH: path.join(workspaceRoot, 'node_modules') },
    });

    if (onProcess) onProcess(proc);

    let stdout = '';
    const logs: string[] = [];

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      const line = d.toString().trim();
      if (line && !/^Debugger listening|^For help see|^Waiting for/.test(line)) {
        logs.push(line);
      }
    });

    const timer = setTimeout(() => {
      proc.kill();
      try { fs.unlinkSync(eventFile); } catch { /* ignore */ }
      resolve({ result: null, durationMs: Date.now() - start, error: 'Lambda invocation timed out', logs });
    }, timeoutMs);

    proc.on('close', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(eventFile); } catch { /* ignore */ }
      const durationMs = Date.now() - start;
      try {
        const parsed = JSON.parse(stdout.trim() || '{"result":null}') as {
          result?: unknown;
          error?: string;
          stack?: string;
        };
        resolve({ result: parsed.result ?? null, durationMs, error: parsed.error, logs });
      } catch {
        resolve({ result: null, durationMs, error: stdout || 'No output from handler', logs });
      }
    });
  });
}

// ── Parse handler spec string ─────────────────────────────────────────────────
// Format: "src/handlers/user.ts#handler"  or  "./handler.js"

export function parseHandlerSpec(spec: string): LambdaHandlerSpec {
  const hashIdx = spec.lastIndexOf('#');
  if (hashIdx !== -1) {
    return {
      handlerPath: spec.slice(0, hashIdx),
      exportName: spec.slice(hashIdx + 1) || 'handler',
    };
  }
  return { handlerPath: spec, exportName: 'handler' };
}
