import { describe, it, expect } from 'vitest';
import {
  flattenDdbValue,
  evaluateExpression,
  applyUpdateExpression,
  buildStorageKey,
} from '../../../src/core/appsync/dataSources/expressionEvaluator';

describe('flattenDdbValue', () => {
  it('unwraps S, N, BOOL, NULL', () => {
    expect(flattenDdbValue({ S: 'hello' })).toBe('hello');
    expect(flattenDdbValue({ N: '42' })).toBe(42);
    expect(flattenDdbValue({ BOOL: true })).toBe(true);
    expect(flattenDdbValue({ NULL: true })).toBeNull();
  });

  it('unwraps L (list) and M (map) recursively', () => {
    expect(flattenDdbValue({ L: [{ S: 'a' }, { N: '1' }] })).toEqual(['a', 1]);
    expect(flattenDdbValue({ M: { name: { S: 'Bob' }, age: { N: '30' } } })).toEqual({ name: 'Bob', age: 30 });
  });

  it('unwraps SS and NS sets', () => {
    expect(flattenDdbValue({ SS: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(flattenDdbValue({ NS: ['1', '2'] })).toEqual([1, 2]);
  });

  it('returns null for null/undefined', () => {
    expect(flattenDdbValue(null)).toBeNull();
    expect(flattenDdbValue(undefined)).toBeNull();
  });

  it('returns the original value for unknown shapes', () => {
    expect(flattenDdbValue({ unknown: 'x' })).toEqual({ unknown: 'x' });
  });
});

describe('evaluateExpression - basic comparisons', () => {
  const item = { id: '1', name: 'Alice', age: 30, active: true };

  it('returns true for empty expression', () => {
    expect(evaluateExpression('', item)).toBe(true);
    expect(evaluateExpression('   ', item)).toBe(true);
  });

  it('evaluates equality with placeholders', () => {
    expect(evaluateExpression('#n = :v', item, { '#n': 'name' }, { ':v': { S: 'Alice' } })).toBe(true);
    expect(evaluateExpression('#n = :v', item, { '#n': 'name' }, { ':v': { S: 'Bob' } })).toBe(false);
  });

  it('evaluates inequality, gt, lt, gte, lte', () => {
    expect(evaluateExpression('age <> :v', item, {}, { ':v': { N: '40' } })).toBe(true);
    expect(evaluateExpression('age > :v', item, {}, { ':v': { N: '20' } })).toBe(true);
    expect(evaluateExpression('age < :v', item, {}, { ':v': { N: '40' } })).toBe(true);
    expect(evaluateExpression('age >= :v', item, {}, { ':v': { N: '30' } })).toBe(true);
    expect(evaluateExpression('age <= :v', item, {}, { ':v': { N: '30' } })).toBe(true);
  });
});

describe('evaluateExpression - boolean composition', () => {
  const item = { name: 'Alice', age: 30, role: 'admin' };

  it('evaluates AND', () => {
    expect(evaluateExpression(
      '#n = :n AND age > :a',
      item, { '#n': 'name' }, { ':n': { S: 'Alice' }, ':a': { N: '20' } },
    )).toBe(true);
  });

  it('evaluates OR', () => {
    expect(evaluateExpression(
      '#n = :n OR age > :a',
      item, { '#n': 'name' }, { ':n': { S: 'Bob' }, ':a': { N: '20' } },
    )).toBe(true);
  });

  it('evaluates NOT', () => {
    expect(evaluateExpression(
      'NOT #n = :n',
      item, { '#n': 'name' }, { ':n': { S: 'Bob' } },
    )).toBe(true);
  });

  it('evaluates parenthesized expressions', () => {
    expect(evaluateExpression(
      '(#n = :n OR #n = :n2) AND age > :a',
      item,
      { '#n': 'name' },
      { ':n': { S: 'Alice' }, ':n2': { S: 'Bob' }, ':a': { N: '20' } },
    )).toBe(true);
  });
});

describe('evaluateExpression - functions', () => {
  const item = { id: '1', name: 'Alice', tags: ['admin', 'user'] };

  it('begins_with', () => {
    expect(evaluateExpression('begins_with(#n, :p)', item, { '#n': 'name' }, { ':p': { S: 'Ali' } })).toBe(true);
    expect(evaluateExpression('begins_with(#n, :p)', item, { '#n': 'name' }, { ':p': { S: 'Xyz' } })).toBe(false);
  });

  it('contains for arrays', () => {
    expect(evaluateExpression('contains(#t, :v)', item, { '#t': 'tags' }, { ':v': { S: 'admin' } })).toBe(true);
    expect(evaluateExpression('contains(#t, :v)', item, { '#t': 'tags' }, { ':v': { S: 'guest' } })).toBe(false);
  });

  it('contains for strings', () => {
    expect(evaluateExpression('contains(#n, :v)', item, { '#n': 'name' }, { ':v': { S: 'lic' } })).toBe(true);
  });

  it('attribute_exists / attribute_not_exists', () => {
    expect(evaluateExpression('attribute_exists(#n)', item, { '#n': 'name' })).toBe(true);
    expect(evaluateExpression('attribute_not_exists(#n)', item, { '#n': 'missing' })).toBe(true);
  });
});

describe('evaluateExpression - IN and BETWEEN', () => {
  const item = { name: 'Alice', age: 30 };

  it('IN clause matches one of multiple values', () => {
    expect(evaluateExpression(
      '#n IN (:a, :b, :c)',
      item,
      { '#n': 'name' },
      { ':a': { S: 'Bob' }, ':b': { S: 'Alice' }, ':c': { S: 'Carol' } },
    )).toBe(true);
  });

  it('BETWEEN matches inclusive range', () => {
    expect(evaluateExpression(
      'age BETWEEN :lo AND :hi',
      item, {}, { ':lo': { N: '20' }, ':hi': { N: '40' } },
    )).toBe(true);
    expect(evaluateExpression(
      'age BETWEEN :lo AND :hi',
      item, {}, { ':lo': { N: '40' }, ':hi': { N: '50' } },
    )).toBe(false);
  });
});

describe('evaluateExpression - error tolerance', () => {
  it('does not throw on malformed input (always returns a boolean)', () => {
    expect(() => evaluateExpression('completely $$$ broken', { id: '1' })).not.toThrow();
    expect(typeof evaluateExpression('completely $$$ broken', { id: '1' })).toBe('boolean');
  });

  it('handles dotted attribute paths', () => {
    expect(evaluateExpression(
      'profile.email = :v',
      { id: '1', profile: { email: 'a@b.com' } },
      {},
      { ':v': { S: 'a@b.com' } },
    )).toBe(true);
  });
});

describe('applyUpdateExpression - SET', () => {
  it('sets a literal value via placeholder', () => {
    const out = applyUpdateExpression(
      { id: '1', name: 'Old' },
      'SET #n = :v',
      { '#n': 'name' },
      { ':v': { S: 'New' } },
    );
    expect(out.name).toBe('New');
  });

  it('handles multiple SET clauses', () => {
    const out = applyUpdateExpression(
      { id: '1' },
      'SET #a = :a, #b = :b',
      { '#a': 'name', '#b': 'age' },
      { ':a': { S: 'X' }, ':b': { N: '99' } },
    );
    expect(out.name).toBe('X');
    expect(out.age).toBe(99);
  });
});

describe('applyUpdateExpression - REMOVE', () => {
  it('removes attributes', () => {
    const out = applyUpdateExpression(
      { id: '1', tmp: 'a', tmp2: 'b' },
      'REMOVE #t1, #t2',
      { '#t1': 'tmp', '#t2': 'tmp2' },
    );
    expect(out).not.toHaveProperty('tmp');
    expect(out).not.toHaveProperty('tmp2');
    expect(out.id).toBe('1');
  });
});

describe('applyUpdateExpression - ADD', () => {
  it('increments numeric counter', () => {
    const out = applyUpdateExpression(
      { id: '1', count: 5 },
      'ADD count :n',
      {},
      { ':n': { N: '3' } },
    );
    expect(out.count).toBe(8);
  });

  it('handles missing counter (no-op since type mismatch is ignored)', () => {
    const out = applyUpdateExpression(
      { id: '1' },
      'ADD count :n',
      {},
      { ':n': { N: '3' } },
    );
    expect(out.count).toBeUndefined();
  });
});

describe('applyUpdateExpression - combined', () => {
  it('SET and REMOVE in one expression', () => {
    const out = applyUpdateExpression(
      { id: '1', name: 'Old', tmp: 'x' },
      'SET #n = :v REMOVE #t',
      { '#n': 'name', '#t': 'tmp' },
      { ':v': { S: 'New' } },
    );
    expect(out.name).toBe('New');
    expect(out).not.toHaveProperty('tmp');
  });
});

describe('buildStorageKey', () => {
  it('returns id directly for single-id key', () => {
    expect(buildStorageKey({ id: '42' })).toBe('42');
  });

  it('joins composite keys with # separator (sorted by attribute name)', () => {
    expect(buildStorageKey({ pk: 'USER#1', sk: 'PROFILE' })).toBe('USER#1#PROFILE');
  });

  it('handles missing values as empty strings', () => {
    expect(buildStorageKey({ pk: 'A', sk: undefined as unknown as string })).toBe('A#');
  });
});
