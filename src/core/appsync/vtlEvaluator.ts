// Minimal AppSync VTL evaluator — handles the patterns used in typical resolver templates.
// Supports: $ctx.*, $util.dynamodb.*, $util.toJson, #set, #if/#elseif/#else/#end, #foreach.

export class VtlError extends Error {
  constructor(message: string, public readonly vtlType?: string) {
    super(message);
    this.name = 'VtlError';
  }
}

// ── DynamoDB value converters ─────────────────────────────────────────────────

function ddbValue(val: unknown): unknown {
  if (val === null || val === undefined) return { NULL: true };
  if (typeof val === 'boolean') return { BOOL: val };
  if (typeof val === 'number') return { N: String(val) };
  if (typeof val === 'string') return { S: val };
  if (Array.isArray(val)) return { L: val.map(ddbValue) };
  if (typeof val === 'object') {
    const m: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      m[k] = ddbValue(v);
    }
    return { M: m };
  }
  return { S: String(val) };
}

function toMapValues(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = ddbValue(v);
  }
  return out;
}

// ── $util implementations ─────────────────────────────────────────────────────

const vtlUtil = {
  dynamodb: {
    toDynamoDBJson: ddbValue,
    toMapValuesJson: toMapValues,
    toStringJson: (v: unknown) => ({ S: String(v ?? '') }),
    toNumberJson: (v: unknown) => ({ N: String(Number(v)) }),
    toBooleanJson: (v: unknown) => ({ BOOL: Boolean(v) }),
    toNullJson: () => ({ NULL: true }),
    toListJson: (arr: unknown) => ({ L: (Array.isArray(arr) ? arr : []).map(ddbValue) }),
    toStringSet: (arr: unknown) => ({ SS: (Array.isArray(arr) ? arr : []).map(String) }),
    toNumberSet: (arr: unknown) => ({ NS: (Array.isArray(arr) ? arr : []).map((v) => String(Number(v))) }),
  },
  toJson: (v: unknown) => JSON.stringify(v),
  parseJson: (s: unknown) => { try { return JSON.parse(String(s)); } catch { return null; } },
  autoId: () => `${Math.random().toString(36).slice(2, 10)}-${Date.now()}`,
  defaultIfNull: (v: unknown, d: unknown) => (v !== null && v !== undefined) ? v : d,
  defaultIfNullOrEmpty: (v: unknown, d: unknown) => (v !== null && v !== undefined && v !== '') ? v : d,
  isNull: (v: unknown) => v === null || v === undefined,
  isNullOrEmpty: (v: unknown) => v === null || v === undefined || v === '',
  error: (msg: string, type?: string): never => { throw new VtlError(String(msg), String(type ?? 'Error')); },
  appendError: (msg: string, type?: string) => { console.warn(`[VTL appendError] ${type ?? 'Error'}: ${msg}`); },
  time: {
    nowISO8601: () => new Date().toISOString(),
    nowEpochSeconds: () => Math.floor(Date.now() / 1000),
    nowEpochMilliSeconds: () => Date.now(),
  },
  str: {
    toUpper: (s: unknown) => String(s).toUpperCase(),
    toLower: (s: unknown) => String(s).toLowerCase(),
    trim: (s: unknown) => String(s).trim(),
  },
  matches: (pattern: string, text: string) => { try { return new RegExp(pattern).test(text); } catch { return false; } },
};

// ── Expression evaluator ──────────────────────────────────────────────────────

function evalExpr(expr: string, ctx: unknown, userVars: Record<string, unknown>): unknown {
  // Convert ${...} braced references to $... form first
  const jsExpr = expr
    .replace(/\$\{([^}]+)\}/g, '$$$1')            // ${ctx.args.id} → $ctx.args.id
    .replace(/\$util\b/g, '__util')
    .replace(/\$ctx\b/g, '__ctx')
    .replace(/\$context\b/g, '__ctx')
    .replace(/\$(\w+)/g, (_m, n) => `(__vars["${n}"] !== undefined ? __vars["${n}"] : null)`)
    .replace(/\.contains\s*\(/g, '.includes(')    // VTL List.contains → JS Array.includes
    .replace(/\bnull\b/g, 'null')
    .replace(/\btrue\b/g, 'true')
    .replace(/\bfalse\b/g, 'false');

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('__ctx', '__util', '__vars', `"use strict"; return (${jsExpr})`);
    return fn(ctx, vtlUtil, userVars);
  } catch {
    return null;
  }
}

// ── Expression scanner (handles nested parens and $ references) ───────────────

function extractExprAt(text: string, dollarIdx: number): { expr: string; end: number } {
  let i = dollarIdx + 1;

  if (text[i] === '{') {
    i++;
    let depth = 1;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      if (text[i] === '}') depth--;
      i++;
    }
    return { expr: text.slice(dollarIdx, i), end: i };
  }

  // Scan identifier (word chars + dots for chained access)
  while (i < text.length && /[\w.]/.test(text[i])) i++;

  // Function call: scan to matching )
  if (text[i] === '(') {
    let depth = 1;
    i++;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      if (text[i] === ')') depth--;
      i++;
    }
  }

  return { expr: text.slice(dollarIdx, i), end: i };
}

function interpolateLine(line: string, ctx: unknown, userVars: Record<string, unknown>): string {
  let result = '';
  let i = 0;
  while (i < line.length) {
    if (line[i] === '$' && i + 1 < line.length && /[\w{]/.test(line[i + 1])) {
      const { expr, end } = extractExprAt(line, i);
      const val = evalExpr(expr, ctx, userVars);
      if (val === null || val === undefined) {
        result += 'null';
      } else if (typeof val === 'object') {
        result += JSON.stringify(val);
      } else {
        result += String(val);
      }
      i = end;
    } else {
      result += line[i++];
    }
  }
  return result;
}

// ── Block collectors ──────────────────────────────────────────────────────────

interface IfBranch { condition: string; lines: string[] }
interface IfBlock { branches: IfBranch[]; elseLines: string[]; consumed: number }

function collectIfBlock(lines: string[], startIdx: number): IfBlock {
  const firstCondMatch = lines[startIdx].trim().match(/^#if\s*\((.*)\)\s*$/);
  let currentCondition = firstCondMatch?.[1] ?? 'false';
  let currentLines: string[] = [];
  const branches: IfBranch[] = [];
  let elseLines: string[] = [];
  let inElse = false;
  let depth = 1;
  let i = startIdx + 1;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (/^#if\s*\(/.test(trimmed)) depth++;

    if (depth === 1 && /^#end\s*$/.test(trimmed)) {
      if (inElse) {
        elseLines = currentLines;
      } else {
        branches.push({ condition: currentCondition, lines: currentLines });
      }
      i++;
      break;
    }

    if (depth === 1 && /^#elseif\s*\(/.test(trimmed)) {
      branches.push({ condition: currentCondition, lines: currentLines });
      const m = trimmed.match(/^#elseif\s*\((.*)\)\s*$/);
      currentCondition = m?.[1] ?? 'false';
      currentLines = [];
      i++;
      continue;
    }

    if (depth === 1 && /^#else\s*$/.test(trimmed)) {
      branches.push({ condition: currentCondition, lines: currentLines });
      inElse = true;
      currentLines = [];
      i++;
      continue;
    }

    if (/^#end\s*$/.test(trimmed)) depth--;
    currentLines.push(lines[i]);
    i++;
  }

  return { branches, elseLines, consumed: i - startIdx };
}

interface ForeachBlock { iterVar: string; listExpr: string; bodyLines: string[]; consumed: number }

function collectForeachBlock(lines: string[], startIdx: number): ForeachBlock {
  const m = lines[startIdx].trim().match(/^#foreach\s*\(\s*\$(\w+)\s+in\s+(.*?)\s*\)\s*$/);
  const iterVar = m?.[1] ?? 'item';
  const listExpr = m?.[2] ?? '$ctx.result';
  const bodyLines: string[] = [];
  let depth = 1;
  let i = startIdx + 1;

  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (/^#foreach/.test(trimmed)) depth++;
    if (/^#end\s*$/.test(trimmed)) {
      depth--;
      if (depth === 0) { i++; break; }
    }
    bodyLines.push(lines[i]);
    i++;
  }

  return { iterVar, listExpr, bodyLines, consumed: i - startIdx };
}

// ── Public evaluator ──────────────────────────────────────────────────────────

export function evaluateVtl(template: string, ctx: unknown): string {
  const stripped = template.replace(/##[^\n]*/g, '');
  const lines = stripped.split('\n');
  const userVars: Record<string, unknown> = {};
  const outputLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // #set($var = expr)
    const setMatch = trimmed.match(/^#set\s*\(\s*\$(\w+)\s*=\s*(.*?)\s*\)$/);
    if (setMatch) {
      const [, varName, expr] = setMatch;
      userVars[varName] = evalExpr(expr, ctx, userVars);
      i++;
      continue;
    }

    // #if
    if (/^#if\s*\(/.test(trimmed)) {
      const { branches, elseLines, consumed } = collectIfBlock(lines, i);
      let selectedLines: string[] = elseLines;
      for (const branch of branches) {
        if (!!evalExpr(branch.condition, ctx, userVars)) {
          selectedLines = branch.lines;
          break;
        }
      }
      for (const sl of selectedLines) {
        outputLines.push(interpolateLine(sl, ctx, userVars));
      }
      i += consumed;
      continue;
    }

    // #foreach
    if (/^#foreach\s*\(/.test(trimmed)) {
      const { iterVar, listExpr, bodyLines, consumed } = collectForeachBlock(lines, i);
      const list = evalExpr(listExpr, ctx, userVars);
      const arr = Array.isArray(list) ? list : (list !== null && list !== undefined ? [list] : []);
      arr.forEach((item, idx) => {
        userVars[iterVar] = item;
        userVars['foreach'] = { hasNext: idx < arr.length - 1, count: idx + 1 };
        for (const bl of bodyLines) {
          outputLines.push(interpolateLine(bl, ctx, userVars));
        }
      });
      delete userVars[iterVar];
      delete userVars['foreach'];
      i += consumed;
      continue;
    }

    if (/^#end\s*$/.test(trimmed) || /^#else\s*$/.test(trimmed)) { i++; continue; }

    outputLines.push(interpolateLine(line, ctx, userVars));
    i++;
  }

  return outputLines.join('\n');
}

export function isVtlTemplate(code: string): boolean {
  return /\$ctx\b/.test(code) || /\$util\.dynamodb\b/.test(code) || /^#set\b/m.test(code) || /^#if\b/m.test(code);
}
