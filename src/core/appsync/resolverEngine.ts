import * as vm from 'vm';
import { AppSyncContext, ResolverLog } from '../../shared/types';
import { $util } from './contextSimulator';
import { inMemoryStore } from './dataSources/inMemoryDataSource';

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
}): Promise<ResolverResult> {
  const logs: ResolverLog[] = [];
  const errors: Array<{ message: string; type?: string }> = [];
  let result: unknown = null;

  const { typeName, fieldName, ctx, requestCode, responseCode } = opts;

  // Phase 1: request
  let requestResult: unknown;
  const reqStart = Date.now();
  try {
    if (requestCode) {
      requestResult = runResolverFunction(requestCode, ctx, 'request');
    } else {
      requestResult = defaultResolver(ctx);
    }
    logs.push({
      timestamp: new Date().toISOString(),
      typeName,
      fieldName,
      phase: 'request',
      input: ctx.arguments,
      output: requestResult,
      durationMs: Date.now() - reqStart,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ message: msg, type: 'RequestError' });
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'error',
      input: ctx.arguments, output: msg, durationMs: Date.now() - reqStart,
    });
    return { data: null, logs, errors };
  }

  // Phase 2: data source resolution (simplified in-memory dispatch)
  const dsResult = resolveDataSource(opts.dataSourceName ?? 'NONE', requestResult as Record<string, unknown>);
  ctx.result = dsResult;

  // Phase 3: response
  const resStart = Date.now();
  try {
    if (responseCode) {
      result = runResolverFunction(responseCode, ctx, 'response');
    } else {
      result = ctx.result;
    }
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'response',
      input: dsResult, output: result, durationMs: Date.now() - resStart,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ message: msg, type: 'ResponseError' });
    logs.push({
      timestamp: new Date().toISOString(),
      typeName, fieldName, phase: 'error',
      input: dsResult, output: msg, durationMs: Date.now() - resStart,
    });
    return { data: null, logs, errors };
  }

  return { data: result, logs, errors: errors.length > 0 ? errors : undefined };
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
