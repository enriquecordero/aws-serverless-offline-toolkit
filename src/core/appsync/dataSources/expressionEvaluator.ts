// Evaluates DynamoDB-style FilterExpression, KeyConditionExpression, and UpdateExpression
// against in-memory items. Covers the common subset used in AppSync JS and VTL resolvers.

// ── DynamoDB value flattening ──────────────────────────────────────────────────

export function flattenDdbValue(v: unknown): unknown {
  if (v === null || v === undefined) { return null; }
  const t = v as Record<string, unknown>;
  if ('S' in t) { return t['S']; }
  if ('N' in t) { return Number(t['N']); }
  if ('BOOL' in t) { return t['BOOL']; }
  if ('NULL' in t) { return null; }
  if ('L' in t) { return (t['L'] as unknown[]).map(flattenDdbValue); }
  if ('M' in t) {
    const m = t['M'] as Record<string, unknown>;
    return Object.fromEntries(Object.entries(m).map(([k, val]) => [k, flattenDdbValue(val)]));
  }
  if ('SS' in t) { return t['SS']; }
  if ('NS' in t) { return (t['NS'] as string[]).map(Number); }
  return v;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveAttr(token: string, names: Record<string, string>): string {
  return token?.startsWith('#') ? (names[token] ?? token.slice(1)) : (token ?? '');
}

function resolveVal(token: string, values: Record<string, unknown>): unknown {
  return token?.startsWith(':') ? flattenDdbValue(values[token]) : token;
}

function getAttr(item: Record<string, unknown>, attr: string): unknown {
  // Support dotted paths: a.b.c
  return attr.split('.').reduce<unknown>(
    (obj, key) => (obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined),
    item
  );
}

function compare(lhs: unknown, op: string, rhs: unknown): boolean {
  switch (op) {
    case '=':  return lhs == rhs;  // loose for number/string coercion
    case '<>': return lhs != rhs;
    case '>':  return (lhs as number) > (rhs as number);
    case '<':  return (lhs as number) < (rhs as number);
    case '>=': return (lhs as number) >= (rhs as number);
    case '<=': return (lhs as number) <= (rhs as number);
    default:   return false;
  }
}

// ── Tokenizer ──────────────────────────────────────────────────────────────────

function tokenize(expr: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) { i++; continue; }
    if (expr.slice(i, i + 2) === '<>') { tokens.push('<>'); i += 2; continue; }
    if (expr.slice(i, i + 2) === '>=') { tokens.push('>='); i += 2; continue; }
    if (expr.slice(i, i + 2) === '<=') { tokens.push('<='); i += 2; continue; }
    if ('<>=(),'.includes(expr[i])) { tokens.push(expr[i]); i++; continue; }
    if (/[a-zA-Z#:_.0-9\-]/.test(expr[i])) {
      let word = '';
      while (i < expr.length && /[a-zA-Z0-9#:_.'\-]/.test(expr[i])) { word += expr[i++]; }
      tokens.push(word);
      continue;
    }
    i++;
  }
  return tokens;
}

// ── Recursive descent parser ───────────────────────────────────────────────────

interface ParseState {
  tokens: string[];
  pos: number;
  item: Record<string, unknown>;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

function parseOr(s: ParseState): boolean {
  let left = parseAnd(s);
  while (s.tokens[s.pos]?.toUpperCase() === 'OR') {
    s.pos++;
    const right = parseAnd(s);
    left = left || right;
  }
  return left;
}

function parseAnd(s: ParseState): boolean {
  let left = parseNot(s);
  // 'AND' consumed here only when it's a boolean AND, not part of BETWEEN...AND...
  while (s.tokens[s.pos]?.toUpperCase() === 'AND') {
    s.pos++;
    const right = parseNot(s);
    left = left && right;
  }
  return left;
}

function parseNot(s: ParseState): boolean {
  if (s.tokens[s.pos]?.toUpperCase() === 'NOT') {
    s.pos++;
    return !parsePrimary(s);
  }
  return parsePrimary(s);
}

const FUNCTIONS = ['begins_with', 'contains', 'attribute_exists', 'attribute_not_exists', 'attribute_type', 'size'];

function parsePrimary(s: ParseState): boolean {
  // Parenthesized sub-expression
  if (s.tokens[s.pos] === '(') {
    s.pos++;
    const val = parseOr(s);
    if (s.tokens[s.pos] === ')') { s.pos++; }
    return val;
  }

  // Function calls
  const fnName = s.tokens[s.pos]?.toLowerCase();
  if (FUNCTIONS.includes(fnName)) {
    s.pos++;
    if (s.tokens[s.pos] === '(') { s.pos++; }
    const attr = resolveAttr(s.tokens[s.pos++], s.names);

    if (fnName === 'attribute_exists') {
      if (s.tokens[s.pos] === ')') { s.pos++; }
      const v = getAttr(s.item, attr);
      return v !== undefined && v !== null;
    }
    if (fnName === 'attribute_not_exists') {
      if (s.tokens[s.pos] === ')') { s.pos++; }
      const v = getAttr(s.item, attr);
      return v === undefined || v === null;
    }

    if (s.tokens[s.pos] === ',') { s.pos++; }
    const val = resolveVal(s.tokens[s.pos++], s.values);
    if (s.tokens[s.pos] === ')') { s.pos++; }

    const itemVal = getAttr(s.item, attr);
    if (fnName === 'begins_with') { return String(itemVal ?? '').startsWith(String(val ?? '')); }
    if (fnName === 'contains') {
      return Array.isArray(itemVal)
        ? (itemVal as unknown[]).some(el => el == val)
        : String(itemVal ?? '').includes(String(val ?? ''));
    }
    return true;
  }

  // attribute op rhs | BETWEEN | IN
  const attr = resolveAttr(s.tokens[s.pos++], s.names);
  const op = s.tokens[s.pos++];

  if (op?.toUpperCase() === 'IN') {
    if (s.tokens[s.pos] === '(') { s.pos++; }
    const vals: unknown[] = [];
    while (s.tokens[s.pos] && s.tokens[s.pos] !== ')') {
      if (s.tokens[s.pos] === ',') { s.pos++; continue; }
      vals.push(resolveVal(s.tokens[s.pos++], s.values));
    }
    if (s.tokens[s.pos] === ')') { s.pos++; }
    const itemVal = getAttr(s.item, attr);
    return vals.some(v => v == itemVal);
  }

  if (op?.toUpperCase() === 'BETWEEN') {
    const low = resolveVal(s.tokens[s.pos++], s.values);
    if (s.tokens[s.pos]?.toUpperCase() === 'AND') { s.pos++; }
    const high = resolveVal(s.tokens[s.pos++], s.values);
    const itemVal = getAttr(s.item, attr) as number;
    return itemVal >= (low as number) && itemVal <= (high as number);
  }

  const rhs = resolveVal(s.tokens[s.pos++], s.values);
  return compare(getAttr(s.item, attr), op, rhs);
}

// ── Public: evaluate a FilterExpression or KeyConditionExpression ──────────────

export function evaluateExpression(
  expression: string,
  item: Record<string, unknown>,
  names: Record<string, string> = {},
  values: Record<string, unknown> = {},
): boolean {
  if (!expression?.trim()) { return true; }
  const state: ParseState = { tokens: tokenize(expression), pos: 0, item, names, values };
  try {
    return parseOr(state);
  } catch {
    return true; // never filter out items due to a parse error
  }
}

// ── Public: apply an UpdateExpression to an item ───────────────────────────────
// Supports SET and REMOVE clauses.

export function applyUpdateExpression(
  item: Record<string, unknown>,
  expression: string,
  names: Record<string, string> = {},
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  const result = { ...item };

  const setMatch = expression.match(/SET\s+([\s\S]+?)(?=\s+(?:REMOVE|ADD|DELETE)\b|$)/i);
  const removeMatch = expression.match(/REMOVE\s+([\s\S]+?)(?=\s+(?:SET|ADD|DELETE)\b|$)/i);
  const addMatch = expression.match(/ADD\s+([\s\S]+?)(?=\s+(?:SET|REMOVE|DELETE)\b|$)/i);

  if (setMatch) {
    for (const clause of splitTopLevel(setMatch[1], ',')) {
      const eqIdx = clause.indexOf('=');
      if (eqIdx === -1) { continue; }
      const attrToken = clause.slice(0, eqIdx).trim();
      const valToken = clause.slice(eqIdx + 1).trim();
      const attr = resolveAttr(attrToken, names);
      const val = valToken.startsWith(':') ? flattenDdbValue(values[valToken]) : valToken;
      result[attr] = val;
    }
  }

  if (removeMatch) {
    for (const attrToken of removeMatch[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const attr = resolveAttr(attrToken, names);
      delete result[attr];
    }
  }

  if (addMatch) {
    for (const clause of splitTopLevel(addMatch[1], ',')) {
      const parts = clause.trim().split(/\s+/);
      if (parts.length < 2) { continue; }
      const attr = resolveAttr(parts[0], names);
      const val = flattenDdbValue(values[parts[1]]);
      const current = result[attr];
      if (typeof current === 'number' && typeof val === 'number') {
        result[attr] = current + val;
      } else if (Array.isArray(current) && Array.isArray(val)) {
        result[attr] = [...new Set([...current, ...val])];
      }
    }
  }

  return result;
}

// ── Public: build a storage key from DynamoDB key attributes ──────────────────

export function buildStorageKey(keyAttrs: Record<string, unknown>): string {
  const keys = Object.keys(keyAttrs).sort();
  if (keys.length === 1 && keys[0] === 'id') { return String(keyAttrs['id'] ?? ''); }
  return keys.map(k => String(keyAttrs[k] ?? '')).join('#');
}

// ── Internal helper ───────────────────────────────────────────────────────────

function splitTopLevel(str: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') { depth++; }
    if (ch === ')') { depth--; }
    if (ch === sep && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  if (cur.trim()) { parts.push(cur.trim()); }
  return parts;
}
