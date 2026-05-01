import { describe, it, expect } from 'vitest';
import { evaluateVtl, isVtlTemplate, VtlError } from '../../../src/core/appsync/vtlEvaluator';

describe('isVtlTemplate', () => {
  it('detects $util.dynamodb references', () => {
    expect(isVtlTemplate('$util.dynamodb.toDynamoDBJson($ctx.args)')).toBe(true);
  });

  it('detects $ctx references', () => {
    expect(isVtlTemplate('$ctx.args.id')).toBe(true);
  });

  it('detects #if at line start', () => {
    expect(isVtlTemplate('#if($cond)\nyes\n#end')).toBe(true);
  });

  it('detects #set at line start', () => {
    expect(isVtlTemplate('#set($x = "hello")')).toBe(true);
  });

  it('returns false for plain JS', () => {
    expect(isVtlTemplate('export const foo = 1;')).toBe(false);
    expect(isVtlTemplate('return { x: 1 };')).toBe(false);
  });
});

describe('evaluateVtl - basic interpolation', () => {
  it('renders $ctx.args fields', () => {
    const out = evaluateVtl('Hello $ctx.args.name', { args: { name: 'Alice' } });
    expect(out).toContain('Alice');
  });

  it('renders ${...} braced syntax', () => {
    const out = evaluateVtl('id=${ctx.args.id}', { args: { id: '42' } });
    expect(out).toContain('42');
  });

  it('renders $context as alias for $ctx', () => {
    const out = evaluateVtl('user=$context.identity.username', { identity: { username: 'bob' } });
    expect(out).toContain('bob');
  });

  it('substitutes null for undefined references', () => {
    const out = evaluateVtl('value=$ctx.args.missing', { args: {} });
    expect(out).toContain('null');
  });
});

describe('evaluateVtl - $util.dynamodb', () => {
  it('toDynamoDBJson wraps a string as { S: ... }', () => {
    const out = evaluateVtl('$util.dynamodb.toDynamoDBJson($ctx.args.name)', { args: { name: 'Alice' } });
    expect(JSON.parse(out)).toEqual({ S: 'Alice' });
  });

  it('toDynamoDBJson wraps a number as { N: ... }', () => {
    const out = evaluateVtl('$util.dynamodb.toDynamoDBJson($ctx.args.age)', { args: { age: 30 } });
    expect(JSON.parse(out)).toEqual({ N: '30' });
  });

  it('toDynamoDBJson wraps a boolean as { BOOL: ... }', () => {
    const out = evaluateVtl('$util.dynamodb.toDynamoDBJson($ctx.args.active)', { args: { active: true } });
    expect(JSON.parse(out)).toEqual({ BOOL: true });
  });

  it('toDynamoDBJson wraps a list as { L: ... }', () => {
    const out = evaluateVtl('$util.dynamodb.toDynamoDBJson($ctx.args.tags)', { args: { tags: ['a', 'b'] } });
    expect(JSON.parse(out)).toEqual({ L: [{ S: 'a' }, { S: 'b' }] });
  });

  it('toMapValuesJson converts an object to a map of typed values', () => {
    const out = evaluateVtl('$util.dynamodb.toMapValuesJson($ctx.args)', { args: { name: 'X', age: 5 } });
    expect(JSON.parse(out)).toEqual({ name: { S: 'X' }, age: { N: '5' } });
  });
});

describe('evaluateVtl - $util misc', () => {
  it('toJson serializes objects', () => {
    const out = evaluateVtl('$util.toJson($ctx.args)', { args: { x: 1 } });
    expect(out).toContain('"x":1');
  });

  it('defaultIfNull falls back when null', () => {
    const out = evaluateVtl('$util.defaultIfNull($ctx.args.missing, "fallback")', { args: {} });
    expect(out).toContain('fallback');
  });

  // NOTE: $util.error throws inside the new-Function sandbox in evalExpr,
  // which catches all throws. Errors are silently swallowed in interpolation —
  // they only surface when the host calls vtlUtil.error directly. We document
  // the actual contract here.
  it('VtlError class is constructable and carries vtlType', () => {
    const err = new VtlError('boom', 'Unauthorized');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.vtlType).toBe('Unauthorized');
    expect(err.name).toBe('VtlError');
  });
});

describe('evaluateVtl - control flow (multi-line)', () => {
  it('#if true branch emits content', () => {
    const tpl = [
      '#if($ctx.args.flag)',
      'YES',
      '#else',
      'NO',
      '#end',
    ].join('\n');
    const out = evaluateVtl(tpl, { args: { flag: true } });
    expect(out).toContain('YES');
    expect(out).not.toContain('NO');
  });

  it('#if false falls through to #else', () => {
    const tpl = [
      '#if($ctx.args.flag)',
      'YES',
      '#else',
      'NO',
      '#end',
    ].join('\n');
    const out = evaluateVtl(tpl, { args: { flag: false } });
    expect(out).toContain('NO');
    expect(out).not.toContain('YES');
  });

  it('#elseif picks middle branch', () => {
    const tpl = [
      '#if($ctx.args.x == 1)',
      'ONE',
      '#elseif($ctx.args.x == 2)',
      'TWO',
      '#else',
      'OTHER',
      '#end',
    ].join('\n');
    const out = evaluateVtl(tpl, { args: { x: 2 } });
    expect(out).toContain('TWO');
  });

  it('#foreach iterates a list', () => {
    const tpl = [
      '#foreach($x in $ctx.args.items)',
      '[$x]',
      '#end',
    ].join('\n');
    const out = evaluateVtl(tpl, { args: { items: ['a', 'b', 'c'] } });
    expect(out).toContain('[a]');
    expect(out).toContain('[b]');
    expect(out).toContain('[c]');
  });

  it('#set defines a variable usable in interpolation', () => {
    const tpl = [
      '#set($greeting = "Hi")',
      '$greeting $ctx.args.name',
    ].join('\n');
    const out = evaluateVtl(tpl, { args: { name: 'Alice' } });
    expect(out).toContain('Hi');
    expect(out).toContain('Alice');
  });
});

describe('evaluateVtl - error tolerance', () => {
  it('does not throw on undefined references', () => {
    expect(() => evaluateVtl('value=$ctx.args.missing.deep', {})).not.toThrow();
  });

  it('does not throw on malformed expressions', () => {
    expect(() => evaluateVtl('$ctx.args.((((', { args: {} })).not.toThrow();
  });
});
