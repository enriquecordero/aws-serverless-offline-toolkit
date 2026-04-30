import * as vm from 'vm';
import { AppSyncContext, ResolverLog, PipelineFunction } from '../../shared/types';
import { $util } from './contextSimulator';
import { inMemoryStore } from './dataSources/inMemoryDataSource';
import { evaluateExpression, applyUpdateExpression, buildStorageKey, flattenDdbValue } from './dataSources/expressionEvaluator';
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

// ─── Data source dispatch ──────────────────────────────────────────────────────

function resolveDataSource(dsName: string, request: Record<string, unknown>): unknown {
  if (!dsName || dsName.toUpperCase() === 'NONE' || !request) { return request; }

  const operation = request['operation'] as string | undefined;
  const tableName = resolveTableName(dsName);

  // Shared expression helpers
  const globalNames = (request['expressionNames'] as Record<string, string>) ?? {};
  const globalValues = (request['expressionValues'] as Record<string, unknown>) ?? {};

  switch (operation) {
    // ── GetItem ─────────────────────────────────────────────────────────────
    case 'GetItem': {
      const flatKey = flattenDdbItem((request['key'] as Record<string, unknown>) ?? {});
      const id = flatKey['id'] as string | undefined;
      if (id !== undefined) {
        return inMemoryStore.getItem(tableName, String(id));
      }
      const storageKey = buildStorageKey(flatKey);
      return inMemoryStore.getItem(tableName, storageKey)
        ?? inMemoryStore.findByAttributes(tableName, flatKey);
    }

    // ── PutItem ─────────────────────────────────────────────────────────────
    case 'PutItem': {
      const flatKey = flattenDdbItem((request['key'] as Record<string, unknown>) ?? {});
      const flatAttrs = flattenDdbItem((request['attributeValues'] as Record<string, unknown>) ?? {});
      const item = { ...flatKey, ...flatAttrs };
      const storageKey = (item['id'] as string) ?? buildStorageKey(flatKey);
      return inMemoryStore.putItem(tableName, item, Object.keys(flatKey).length ? storageKey : undefined);
    }

    // ── DeleteItem ───────────────────────────────────────────────────────────
    case 'DeleteItem': {
      const flatKey = flattenDdbItem((request['key'] as Record<string, unknown>) ?? {});
      const id = flatKey['id'] as string | undefined;
      if (id !== undefined) { return inMemoryStore.deleteItem(tableName, String(id)); }
      const storageKey = buildStorageKey(flatKey);
      return inMemoryStore.deleteItem(tableName, storageKey)
        ?? inMemoryStore.deleteByAttributes(tableName, flatKey);
    }

    // ── UpdateItem ───────────────────────────────────────────────────────────
    case 'UpdateItem': {
      const flatKey = flattenDdbItem((request['key'] as Record<string, unknown>) ?? {});
      const id = flatKey['id'] as string | undefined;
      const storageKey = id !== undefined ? String(id) : buildStorageKey(flatKey);

      const existing = inMemoryStore.getItem(tableName, storageKey)
        ?? inMemoryStore.findByAttributes(tableName, flatKey)
        ?? {};

      // UpdateExpression (SET / REMOVE / ADD)
      const updateBlock = request['update'] as { expression?: string; expressionNames?: Record<string, string>; expressionValues?: Record<string, unknown> } | undefined;
      const expression = updateBlock?.expression ?? (request['expression'] as string | undefined);
      const exprNames = { ...globalNames, ...(updateBlock?.expressionNames ?? {}) };
      const exprValues = { ...globalValues, ...(updateBlock?.expressionValues ?? {}) };

      let updated: Record<string, unknown>;
      if (expression) {
        updated = applyUpdateExpression({ ...existing, ...flatKey }, expression, exprNames, exprValues);
      } else {
        const attrs = flattenDdbItem((request['attributeValues'] as Record<string, unknown>) ?? {});
        updated = { ...existing, ...flatKey, ...attrs };
      }

      inMemoryStore.putItem(tableName, updated, storageKey);
      return updated;
    }

    // ── Query ────────────────────────────────────────────────────────────────
    case 'Query': {
      const queryBlock = request['query'] as { expression?: string; expressionNames?: Record<string, string>; expressionValues?: Record<string, unknown> } | undefined;
      const filterBlock = request['filter'] as { expression?: string; expressionNames?: Record<string, string>; expressionValues?: Record<string, unknown> } | undefined;
      const limit = (request['limit'] as number | undefined) ?? Infinity;
      const nextToken = request['nextToken'] as string | undefined;
      const scanIndexForward = request['scanIndexForward'] !== false;

      const keyNames = { ...globalNames, ...(queryBlock?.expressionNames ?? {}) };
      const keyValues = { ...globalValues, ...(queryBlock?.expressionValues ?? {}) };
      const filterNames = { ...globalNames, ...(filterBlock?.expressionNames ?? {}) };
      const filterValues = { ...globalValues, ...(filterBlock?.expressionValues ?? {}) };

      let items = inMemoryStore.scan(tableName);

      if (queryBlock?.expression) {
        items = items.filter(item => evaluateExpression(queryBlock.expression!, item, keyNames, keyValues));
      }
      if (filterBlock?.expression) {
        items = items.filter(item => evaluateExpression(filterBlock.expression!, item, filterNames, filterValues));
      }
      if (!scanIndexForward) { items = [...items].reverse(); }

      return paginate(items, limit, nextToken);
    }

    // ── Scan ─────────────────────────────────────────────────────────────────
    case 'Scan': {
      const filterBlock = request['filter'] as { expression?: string; expressionNames?: Record<string, string>; expressionValues?: Record<string, unknown> } | undefined;
      const limit = (request['limit'] as number | undefined) ?? Infinity;
      const nextToken = request['nextToken'] as string | undefined;

      const filterNames = { ...globalNames, ...(filterBlock?.expressionNames ?? {}) };
      const filterValues = { ...globalValues, ...(filterBlock?.expressionValues ?? {}) };

      let items = inMemoryStore.scan(tableName);
      if (filterBlock?.expression) {
        items = items.filter(item => evaluateExpression(filterBlock.expression!, item, filterNames, filterValues));
      }

      return paginate(items, limit, nextToken);
    }

    default:
      return request; // passthrough for unknown operations
  }
}

function paginate(
  items: Record<string, unknown>[],
  limit: number,
  nextToken?: string,
): { items: Record<string, unknown>[]; nextToken: string | null; scannedCount: number } {
  let startIdx = 0;
  if (nextToken) {
    try { startIdx = parseInt(Buffer.from(nextToken, 'base64').toString('utf8'), 10) + 1; } catch { /* ignore */ }
  }
  const effectiveLimit = isFinite(limit) ? limit : items.length;
  const page = items.slice(startIdx, startIdx + effectiveLimit);
  const endIdx = startIdx + page.length - 1;
  const hasMore = endIdx < items.length - 1 && page.length > 0;
  const outToken = hasMore ? Buffer.from(String(endIdx)).toString('base64') : null;
  return { items: page, nextToken: outToken, scannedCount: items.length };
}

function flattenDdbItem(attrs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    result[k] = flattenDdbValue(v);
  }
  return result;
}

function resolveTableName(dsName: string): string {
  if (inMemoryStore.hasTable(dsName)) { return dsName; }
  const noSuffix = dsName.replace(/Table$/i, '');
  if (inMemoryStore.hasTable(noSuffix)) { return noSuffix; }
  const lower = noSuffix.toLowerCase();
  for (const candidate of inMemoryStore.tableNames()) {
    if (candidate.toLowerCase() === lower || candidate.toLowerCase().includes(lower)) { return candidate; }
  }
  return dsName;
}
