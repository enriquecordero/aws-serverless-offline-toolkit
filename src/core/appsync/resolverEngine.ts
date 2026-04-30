import * as vm from 'vm';
import { AppSyncContext, ResolverLog, PipelineFunction } from '../../shared/types';
import { $util } from './contextSimulator';
import { inMemoryStore } from './dataSources/inMemoryDataSource';
import { evaluateVtl, isVtlTemplate, VtlError } from './vtlEvaluator';
import { LambdaHandlerSpec, invokeLambdaLocally, buildAppSyncLambdaEvent } from './lambdaRunner';

export interface ResolverResult {
  data: unknown;
  logs: ResolverLog[];
  errors?: Array<{ message: string; type?: string }>;
}

// ─── Execute a JS resolver function (request or response) ────────────────────

function runResolverFunction(
  code: string,
  ctx: AppSyncContext,
  phase: 'request' | 'response'
): unknown {
  const normalizedCode = code
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');

  // Wrap the resolver code — AppSync JS resolvers export request(ctx) / response(ctx)
  const wrapped = `
    ${normalizedCode}
    __result__ = ${phase}(ctx);
  `;

  const sandbox: Record<string, unknown> = {
    ctx,
    context: ctx, // alias
    $util,
    __result__: undefined,
    console: {
      log: (...args: unknown[]) => console.log('[resolver]', ...args),
      warn: (...args: unknown[]) => console.warn('[resolver]', ...args),
      error: (...args: unknown[]) => console.error('[resolver]', ...args),
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox, { timeout: 3000 });
  return sandbox['__result__'];
}

// ─── Default passthrough resolver (NONE data source) ─────────────────────────

function defaultResolver(ctx: AppSyncContext): unknown {
  return ctx.arguments;
}

// ─── Main resolver engine ─────────────────────────────────────────────────────

export async function executeResolver(opts: {
  typeName: string;
  fieldName: string;
  args: Record<string, unknown>;
  source: Record<string, unknown> | null;
  ctx: AppSyncContext;
  requestCode?: string;
  responseCode?: string;
  dataSourceName?: string;
  resolverType?: 'JS' | 'VTL';
  lambdaHandler?: LambdaHandlerSpec;
  pipeline?: PipelineFunction[];
  getLambdaHandler?: (dsName: string) => LambdaHandlerSpec | undefined;
  workspaceRoot?: string;
  traceId?: string;
  identityType?: string;
}): Promise<ResolverResult> {
  if (opts.pipeline && opts.pipeline.length > 0) {
    return executePipelineResolver({ ...opts, pipeline: opts.pipeline });
  }
  const logs: ResolverLog[] = [];
  const errors: Array<{ message: string; type?: string }> = [];
  let result: unknown = null;

  const { typeName, fieldName, ctx, requestCode, responseCode, resolverType, traceId, identityType } = opts;
  const isVtl = resolverType === 'VTL';
  // VTL resolvers use $ctx.args as alias for $ctx.arguments
  const vtlCtx = isVtl ? { ...ctx, args: ctx.arguments } : ctx;

  // Phase 1: request
  let requestResult: unknown;
  const reqStart = Date.now();
  try {
    if (requestCode) {
      if (isVtl) {
        const rendered = evaluateVtl(requestCode, vtlCtx).trim();
        requestResult = rendered ? JSON.parse(rendered) : {};
      } else {
        requestResult = runResolverFunction(requestCode, ctx, 'request');
      }
    } else {
      requestResult = defaultResolver(ctx);
    }
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'request',
      input: ctx.arguments, output: requestResult,
      durationMs: Date.now() - reqStart, traceId, identityType,
    });
  } catch (err: unknown) {
    const msg = err instanceof VtlError ? `[VTL] ${err.message}` : (err instanceof Error ? err.message : String(err));
    errors.push({ message: msg, type: err instanceof VtlError ? (err.vtlType ?? 'VtlError') : 'RequestError' });
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'error',
      input: ctx.arguments, output: msg,
      durationMs: Date.now() - reqStart, traceId, identityType,
    });
    return { data: null, logs, errors };
  }

  // Phase 2: data source resolution
  let dsResult: unknown;
  if (opts.lambdaHandler) {
    const lambdaEvent = buildAppSyncLambdaEvent(ctx);
    const dsStart = Date.now();
    const lambdaResult = await invokeLambdaLocally({
      handlerSpec: opts.lambdaHandler,
      event: lambdaEvent,
      workspaceRoot: opts.workspaceRoot ?? '',
    });
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: lambdaResult.error ? 'error' : 'response',
      input: lambdaEvent,
      output: lambdaResult.error ? { error: lambdaResult.error } : lambdaResult.result,
      durationMs: lambdaResult.durationMs || (Date.now() - dsStart),
      traceId, identityType,
    });
    if (lambdaResult.error) {
      errors.push({ message: lambdaResult.error, type: 'LambdaError' });
      return { data: null, logs, errors };
    }
    dsResult = lambdaResult.result;
  } else {
    dsResult = resolveDataSource(opts.dataSourceName ?? 'NONE', requestResult as Record<string, unknown>);
  }
  ctx.result = dsResult;

  // Phase 3: response
  const resStart = Date.now();
  try {
    if (responseCode) {
      if (isVtl) {
        const vtlCtxWithResult = { ...vtlCtx, result: dsResult };
        const rendered = evaluateVtl(responseCode, vtlCtxWithResult).trim();
        if (rendered) {
          try { result = JSON.parse(rendered); } catch { result = rendered; }
        } else {
          result = dsResult;
        }
      } else {
        result = runResolverFunction(responseCode, ctx, 'response');
      }
    } else {
      result = ctx.result;
    }
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'response',
      input: dsResult, output: result,
      durationMs: Date.now() - resStart, traceId, identityType,
    });
  } catch (err: unknown) {
    const msg = err instanceof VtlError ? `[VTL] ${err.message}` : (err instanceof Error ? err.message : String(err));
    errors.push({ message: msg, type: err instanceof VtlError ? (err.vtlType ?? 'VtlError') : 'ResponseError' });
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'error',
      input: dsResult, output: msg,
      durationMs: Date.now() - resStart, traceId, identityType,
    });
    return { data: null, logs, errors };
  }

  return { data: result, logs, errors: errors.length > 0 ? errors : undefined };
}

// ─── Pipeline resolver execution ──────────────────────────────────────────────

async function executePipelineResolver(opts: {
  typeName: string;
  fieldName: string;
  ctx: AppSyncContext;
  requestCode?: string;
  responseCode?: string;
  pipeline: PipelineFunction[];
  getLambdaHandler?: (dsName: string) => LambdaHandlerSpec | undefined;
  workspaceRoot?: string;
  traceId?: string;
  identityType?: string;
}): Promise<ResolverResult> {
  const { typeName, fieldName, ctx, traceId, identityType } = opts;
  const logs: ResolverLog[] = [];
  const errors: Array<{ message: string; type?: string }> = [];

  function pushLog(phase: ResolverLog['phase'], input: unknown, output: unknown, durationMs: number, pipelineStep: string): void {
    logs.push({ timestamp: new Date().toISOString(), typeName, fieldName, phase, input, output, durationMs, traceId, identityType, pipelineStep });
  }

  function handleError(err: unknown, type: string, input: unknown, start: number, pipelineStep: string): string {
    const msg = err instanceof VtlError ? `[VTL] ${err.message}` : (err instanceof Error ? err.message : String(err));
    errors.push({ message: msg, type });
    pushLog('error', input, msg, Date.now() - start, pipelineStep);
    return msg;
  }

  function runCode(code: string, phase: 'request' | 'response'): unknown {
    return isVtlTemplate(code)
      ? (() => { const r = evaluateVtl(code, { ...ctx, args: ctx.arguments }).trim(); return r ? JSON.parse(r) : (phase === 'request' ? {} : ctx.result); })()
      : runResolverFunction(code, ctx, phase);
  }

  // ── Before template ────────────────────────────────────────────────────────
  if (opts.requestCode) {
    const t = Date.now();
    try {
      runCode(opts.requestCode, 'request');
      pushLog('request', ctx.arguments, ctx.stash, Date.now() - t, '[before]');
    } catch (err) {
      handleError(err, 'BeforeError', ctx.arguments, t, '[before]');
      return { data: null, logs, errors };
    }
  }

  // ── Pipeline functions ─────────────────────────────────────────────────────
  let prevResult: unknown = null;

  for (const fn of opts.pipeline) {
    ctx.prev = { result: prevResult };
    const isVtl = fn.resolverType === 'VTL';

    // Request
    let fnReqResult: unknown;
    const reqT = Date.now();
    try {
      if (fn.requestMappingTemplate) {
        if (isVtl) {
          const rendered = evaluateVtl(fn.requestMappingTemplate, { ...ctx, args: ctx.arguments }).trim();
          fnReqResult = rendered ? JSON.parse(rendered) : {};
        } else {
          fnReqResult = runResolverFunction(fn.requestMappingTemplate, ctx, 'request');
        }
      } else {
        fnReqResult = defaultResolver(ctx);
      }
      pushLog('request', ctx.arguments, fnReqResult, Date.now() - reqT, fn.name);
    } catch (err) {
      handleError(err, 'FunctionRequestError', ctx.arguments, reqT, fn.name);
      return { data: null, logs, errors };
    }

    // Data source
    let fnDsResult: unknown;
    const lambdaHandler = opts.getLambdaHandler?.(fn.dataSource);
    if (lambdaHandler) {
      const lambdaEvent = buildAppSyncLambdaEvent(ctx);
      const dsT = Date.now();
      const lambdaResult = await invokeLambdaLocally({ handlerSpec: lambdaHandler, event: lambdaEvent, workspaceRoot: opts.workspaceRoot ?? '' });
      pushLog(
        lambdaResult.error ? 'error' : 'response',
        lambdaEvent,
        lambdaResult.error ? { error: lambdaResult.error } : lambdaResult.result,
        lambdaResult.durationMs || (Date.now() - dsT),
        `${fn.name}:lambda`,
      );
      if (lambdaResult.error) {
        errors.push({ message: lambdaResult.error, type: 'LambdaError' });
        return { data: null, logs, errors };
      }
      fnDsResult = lambdaResult.result;
    } else {
      fnDsResult = resolveDataSource(fn.dataSource, fnReqResult as Record<string, unknown>);
    }
    ctx.result = fnDsResult;

    // Response
    let fnResult: unknown;
    const resT = Date.now();
    try {
      if (fn.responseMappingTemplate) {
        if (isVtl) {
          const rendered = evaluateVtl(fn.responseMappingTemplate, { ...ctx, args: ctx.arguments }).trim();
          fnResult = rendered ? (() => { try { return JSON.parse(rendered); } catch { return rendered; } })() : fnDsResult;
        } else {
          fnResult = runResolverFunction(fn.responseMappingTemplate, ctx, 'response');
        }
      } else {
        fnResult = ctx.result;
      }
      pushLog('response', fnDsResult, fnResult, Date.now() - resT, fn.name);
    } catch (err) {
      handleError(err, 'FunctionResponseError', fnDsResult, resT, fn.name);
      return { data: null, logs, errors };
    }

    prevResult = fnResult;
  }

  ctx.prev = { result: prevResult };

  // ── After template ─────────────────────────────────────────────────────────
  let finalResult: unknown = prevResult;
  if (opts.responseCode) {
    const t = Date.now();
    try {
      ctx.result = prevResult;
      finalResult = runCode(opts.responseCode, 'response');
      pushLog('response', prevResult, finalResult, Date.now() - t, '[after]');
    } catch (err) {
      handleError(err, 'AfterError', prevResult, t, '[after]');
      return { data: null, logs, errors };
    }
  }

  return { data: finalResult, logs, errors: errors.length > 0 ? errors : undefined };
}

// ─── Simple data source dispatch ─────────────────────────────────────────────

function resolveDataSource(dsName: string, request: Record<string, unknown>): unknown {
  const normalizedDsName = dsName.toUpperCase();
  if (normalizedDsName === 'NONE' || dsName.toLowerCase() === 'none' || !request) {
    return request;
  }

  // Attempt to interpret a DynamoDB-like operation from the request mapping
  const operation = request['operation'] as string | undefined;
  const tableName = resolveTableName(dsName);

  switch (operation) {
    case 'GetItem': {
      const key = (request['key'] as Record<string, { S?: string; N?: string }>);
      const id = key?.['id']?.S ?? key?.['id']?.N;
      if (id !== undefined && id !== null) {
        return inMemoryStore.getItem(tableName, String(id));
      }

      const flatKey = flattenDdbItem((request['key'] as Record<string, unknown>) ?? {});
      return inMemoryStore.findByAttributes(tableName, flatKey);
    }
    case 'PutItem': {
      const item = flattenDdbItem(request['attributeValues'] as Record<string, unknown> ?? {});
      return inMemoryStore.putItem(tableName, item);
    }
    case 'DeleteItem': {
      const key = (request['key'] as Record<string, { S?: string }>);
      const id = key?.['id']?.S;
      if (id) {
        return inMemoryStore.deleteItem(tableName, id);
      }
      return null;
    }
    case 'UpdateItem': {
      const key = (request['key'] as Record<string, { S?: string }>);
      const id = key?.['id']?.S ?? '';
      const updates = flattenDdbItem(request['attributeValues'] as Record<string, unknown> ?? {});
      return inMemoryStore.updateItem(tableName, id, updates);
    }
    case 'Scan':
    case 'Query':
      {
        const items = inMemoryStore.listItems(tableName);
        return {
          items,
          scannedCount: inMemoryStore.scan(tableName).length,
          nextCursor: null,
          hasMore: false,
          unreadCount: items.filter(i => i && i['isRead'] === false).length,
        };
      }
    default:
      return request; // passthrough
  }
}

function flattenDdbItem(attrs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    const typed = v as Record<string, unknown>;
    result[k] = typed['S'] ?? typed['N'] ?? typed['BOOL'] ?? typed['NULL'] ?? v;
  }
  return result;
}

function resolveTableName(dsName: string): string {
  if (inMemoryStore.hasTable(dsName)) {
    return dsName;
  }

  const noTableSuffix = dsName.replace(/Table$/i, '');
  if (inMemoryStore.hasTable(noTableSuffix)) {
    return noTableSuffix;
  }

  const lower = noTableSuffix.toLowerCase();
  for (const candidate of inMemoryStore.tableNames()) {
    if (candidate.toLowerCase() === lower || candidate.toLowerCase().includes(lower)) {
      return candidate;
    }
  }

  return dsName;
}
