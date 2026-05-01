import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildRuleSet, evaluateRule } from '../../../src/core/cdkDiff/ruleEngine';
import type { RulesFile, RiskRule } from '../../../src/core/cdkDiff/ruleEngine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function input(overrides: Partial<{
  changeType: string;
  category: string;
  rawLine: string;
  logicalId: string;
  resourceType: string;
}> = {}) {
  return {
    changeType: 'modified',
    category: 'Other',
    rawLine: '',
    logicalId: 'TestResource',
    resourceType: 'AWS::Generic::Resource',
    ...overrides,
  };
}

let createdRoots: string[] = [];

beforeEach(() => { createdRoots = []; });
afterEach(() => {
  for (const r of createdRoots) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});

function makeWorkspaceWithRules(rules: Partial<RulesFile> | RulesFile | object): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-rules-'));
  createdRoots.push(root);
  const rulesDir = path.join(root, '.aws-toolkit', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(path.join(rulesDir, 'custom.json'), JSON.stringify(rules));
  return root;
}

// ─── buildRuleSet ─────────────────────────────────────────────────────────────

describe('buildRuleSet', () => {
  it('returns built-in rules when no workspace roots given', () => {
    const rules = buildRuleSet();
    expect(rules.length).toBeGreaterThan(10);
  });

  it('returns rules sorted by ascending priority', () => {
    const rules = buildRuleSet();
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i].priority).toBeGreaterThanOrEqual(rules[i - 1].priority);
    }
  });

  it('built-in rules include expected IDs', () => {
    const ids = new Set(buildRuleSet().map(r => r.id));
    expect(ids.has('S3_DELETE')).toBe(true);
    expect(ids.has('IAM_WILDCARD')).toBe(true);
    expect(ids.has('NEW_RESOURCE')).toBe(true);
  });

  it('loads project rules from .aws-toolkit/rules/*.json', () => {
    const extraRule: RiskRule = {
      id: 'CUSTOM_RULE',
      priority: 50,
      conditions: { category: 'SQS', changeType: 'deleted' },
      result: { level: 'critical', explanation: 'Custom: {logicalId} deleted.' },
    };
    const root = makeWorkspaceWithRules({ schemaVersion: '1', rules: [extraRule] });
    const rules = buildRuleSet([root]);
    expect(rules.some(r => r.id === 'CUSTOM_RULE')).toBe(true);
  });

  it('project rule with same id replaces built-in rule', () => {
    const override: RiskRule = {
      id: 'S3_DELETE',
      priority: 100,
      conditions: { changeType: 'deleted', category: 'S3' },
      result: { level: 'medium', explanation: 'Overridden: {logicalId}.' },
    };
    const root = makeWorkspaceWithRules({ schemaVersion: '1', rules: [override] });
    const rules = buildRuleSet([root]);
    const s3DeleteRule = rules.find(r => r.id === 'S3_DELETE');
    expect(s3DeleteRule?.result.level).toBe('medium');
    expect(rules.filter(r => r.id === 'S3_DELETE').length).toBe(1);
  });

  it('returns no project rules when .aws-toolkit/rules does not exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-norules-'));
    createdRoots.push(root);
    const rules = buildRuleSet([root]);
    expect(rules.length).toBeGreaterThan(0); // built-ins still present
  });

  it('skips malformed project rule files without throwing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-badrul-'));
    createdRoots.push(root);
    const rulesDir = path.join(root, '.aws-toolkit', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    fs.writeFileSync(path.join(rulesDir, 'broken.json'), 'not json at all');
    expect(() => buildRuleSet([root])).not.toThrow();
  });

  it('skips project rule files with missing rules array without throwing', () => {
    const root = makeWorkspaceWithRules({ schemaVersion: '1' }); // no rules key
    expect(() => buildRuleSet([root])).not.toThrow();
  });
});

// ─── evaluateRule ─────────────────────────────────────────────────────────────

describe('evaluateRule', () => {
  it('returns fallback low result when no rules match', () => {
    const result = evaluateRule([], input());
    expect(result.level).toBe('low');
    expect(result.explanation).toContain('TestResource');
  });

  it('applies explanation template variable substitution', () => {
    const rules = buildRuleSet();
    const result = evaluateRule(rules, input({ changeType: 'added', category: 'Lambda', logicalId: 'MyFunc' }));
    expect(result.explanation).toContain('MyFunc');
    expect(result.explanation).toContain('Lambda');
  });

  it('first matching rule wins (priority order respected)', () => {
    const rules: RiskRule[] = [
      {
        id: 'RULE_A',
        priority: 1,
        conditions: { changeType: 'deleted' },
        result: { level: 'critical', explanation: 'Rule A: {logicalId}' },
      },
      {
        id: 'RULE_B',
        priority: 2,
        conditions: { changeType: 'deleted' },
        result: { level: 'low', explanation: 'Rule B: {logicalId}' },
      },
    ];
    const result = evaluateRule(rules, input({ changeType: 'deleted' }));
    expect(result.level).toBe('critical');
    expect(result.explanation).toContain('Rule A');
  });

  it('condition changeType array matches any listed value', () => {
    const rules: RiskRule[] = [{
      id: 'MULTI',
      priority: 1,
      conditions: { changeType: ['deleted', 'replaced'] },
      result: { level: 'high', explanation: 'Multi match' },
    }];
    expect(evaluateRule(rules, input({ changeType: 'deleted' })).level).toBe('high');
    expect(evaluateRule(rules, input({ changeType: 'replaced' })).level).toBe('high');
    expect(evaluateRule(rules, input({ changeType: 'added' })).level).toBe('low');
  });

  it('condition changeTypeNot excludes specific values', () => {
    const rules: RiskRule[] = [{
      id: 'NOT_ADDED',
      priority: 1,
      conditions: { changeTypeNot: 'added' },
      result: { level: 'medium', explanation: 'Not added' },
    }];
    expect(evaluateRule(rules, input({ changeType: 'modified' })).level).toBe('medium');
    expect(evaluateRule(rules, input({ changeType: 'added' })).level).toBe('low');
  });

  it('condition rawLineContains does case-insensitive matching', () => {
    const rules: RiskRule[] = [{
      id: 'CASE_TEST',
      priority: 1,
      conditions: { rawLineContains: 'PUBLIC' },
      result: { level: 'high', explanation: 'Public found' },
    }];
    expect(evaluateRule(rules, input({ rawLine: 'PublicAccessBlockConfiguration' })).level).toBe('high');
    expect(evaluateRule(rules, input({ rawLine: 'private config' })).level).toBe('low');
  });

  it('condition categoryNot excludes specific category', () => {
    const rules: RiskRule[] = [{
      id: 'NOT_OTHER',
      priority: 1,
      conditions: { changeType: 'deleted', categoryNot: 'Other' },
      result: { level: 'high', explanation: 'Generic delete' },
    }];
    expect(evaluateRule(rules, input({ changeType: 'deleted', category: 'Lambda' })).level).toBe('high');
    expect(evaluateRule(rules, input({ changeType: 'deleted', category: 'Other' })).level).toBe('low');
  });

  it('recommendation template is substituted', () => {
    const rules: RiskRule[] = [{
      id: 'REC_TEST',
      priority: 1,
      conditions: {},
      result: { level: 'low', explanation: 'x', recommendation: 'Check {logicalId} in {category}.' },
    }];
    const result = evaluateRule(rules, input({ logicalId: 'MyFn', category: 'Lambda' }));
    expect(result.recommendation).toBe('Check MyFn in Lambda.');
  });

  it('result has no recommendation field when rule omits it', () => {
    const rules: RiskRule[] = [{
      id: 'NO_REC',
      priority: 1,
      conditions: {},
      result: { level: 'low', explanation: 'No rec.' },
    }];
    expect(evaluateRule(rules, input()).recommendation).toBeUndefined();
  });
});

// ─── End-to-end: project override changes analysis outcome ───────────────────

describe('project overrides end-to-end', () => {
  it('override downgrades S3 delete to medium for a workspace that accepts it', () => {
    const override: RiskRule = {
      id: 'S3_DELETE',
      priority: 100,
      conditions: { changeType: 'deleted', category: 'S3' },
      result: { level: 'medium', explanation: 'Intentional delete of {logicalId}.' },
    };
    const root = makeWorkspaceWithRules({ schemaVersion: '1', rules: [override] });
    const rules = buildRuleSet([root]);
    const result = evaluateRule(rules, input({ changeType: 'deleted', category: 'S3', logicalId: 'TmpBucket' }));
    expect(result.level).toBe('medium');
    expect(result.explanation).toContain('TmpBucket');
  });

  it('new custom rule adds project-specific detection', () => {
    const customRule: RiskRule = {
      id: 'NO_STEP_FUNCTIONS',
      priority: 50,
      conditions: { category: 'Other', rawLineContains: 'StepFunctions' },
      result: { level: 'critical', explanation: 'Step Functions not allowed in this project.' },
    };
    const root = makeWorkspaceWithRules({ schemaVersion: '1', rules: [customRule] });
    const rules = buildRuleSet([root]);
    const result = evaluateRule(rules, input({ rawLine: 'AWS::StepFunctions::StateMachine', category: 'Other' }));
    expect(result.level).toBe('critical');
  });
});
