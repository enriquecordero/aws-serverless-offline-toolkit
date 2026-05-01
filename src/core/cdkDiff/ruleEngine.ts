import * as fs from 'fs';
import * as path from 'path';
import type { RiskLevel, ChangeType, ResourceCategory } from '../../shared/types';
import type { RiskResult } from './riskAnalyzer';
import BUILTIN_RULES_FILE from './riskRules.json';

// ─── Public schema types (used for project-level rule files) ─────────────────

export interface RuleCondition {
  changeType?: ChangeType | ChangeType[];
  changeTypeNot?: ChangeType | ChangeType[];
  category?: ResourceCategory | ResourceCategory[];
  categoryNot?: ResourceCategory | ResourceCategory[];
  rawLineContains?: string;
}

export interface RuleResult {
  level: RiskLevel;
  explanation: string;
  recommendation?: string;
}

export interface RiskRule {
  id: string;
  priority: number;
  conditions: RuleCondition;
  result: RuleResult;
}

export interface RulesFile {
  schemaVersion: '1';
  rules: RiskRule[];
}

// ─── Condition matching ───────────────────────────────────────────────────────

function matchesCondition(
  cond: RuleCondition,
  input: { changeType: string; category: string; rawLine: string },
): boolean {
  if (cond.changeType !== undefined) {
    const allowed = Array.isArray(cond.changeType) ? cond.changeType : [cond.changeType];
    if (!allowed.includes(input.changeType as ChangeType)) { return false; }
  }
  if (cond.changeTypeNot !== undefined) {
    const denied = Array.isArray(cond.changeTypeNot) ? cond.changeTypeNot : [cond.changeTypeNot];
    if (denied.includes(input.changeType as ChangeType)) { return false; }
  }
  if (cond.category !== undefined) {
    const allowed = Array.isArray(cond.category) ? cond.category : [cond.category];
    if (!allowed.includes(input.category as ResourceCategory)) { return false; }
  }
  if (cond.categoryNot !== undefined) {
    const denied = Array.isArray(cond.categoryNot) ? cond.categoryNot : [cond.categoryNot];
    if (denied.includes(input.category as ResourceCategory)) { return false; }
  }
  if (cond.rawLineContains !== undefined) {
    if (!input.rawLine.toLowerCase().includes(cond.rawLineContains.toLowerCase())) { return false; }
  }
  return true;
}

// ─── Template substitution ────────────────────────────────────────────────────

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

// ─── Project-level rule loading ───────────────────────────────────────────────

function loadProjectRules(workspaceRoots: string[]): RiskRule[] {
  const rules: RiskRule[] = [];
  for (const root of workspaceRoots) {
    const rulesDir = path.join(root, '.aws-toolkit', 'rules');
    if (!fs.existsSync(rulesDir)) { continue; }
    let files: string[];
    try {
      files = fs.readdirSync(rulesDir).filter(f => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(rulesDir, file), 'utf-8');
        const parsed = JSON.parse(raw) as Partial<RulesFile>;
        if (Array.isArray(parsed.rules)) {
          rules.push(...(parsed.rules as RiskRule[]));
        }
      } catch {
        // skip malformed files silently
      }
    }
  }
  return rules;
}

// ─── Rule set builder ─────────────────────────────────────────────────────────

export function buildRuleSet(workspaceRoots?: string[]): RiskRule[] {
  const builtin = BUILTIN_RULES_FILE.rules as RiskRule[];
  const overrides = workspaceRoots ? loadProjectRules(workspaceRoots) : [];

  const overrideIds = new Set(overrides.map(r => r.id));
  const merged = [
    ...builtin.filter(r => !overrideIds.has(r.id)),
    ...overrides,
  ];
  return merged.sort((a, b) => a.priority - b.priority);
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

export function evaluateRule(
  rules: RiskRule[],
  input: {
    changeType: string;
    category: string;
    rawLine: string;
    logicalId: string;
    resourceType: string;
  },
): RiskResult {
  const vars: Record<string, string> = {
    logicalId: input.logicalId,
    category: input.category,
    changeType: input.changeType,
    resourceType: input.resourceType,
  };

  for (const rule of rules) {
    if (matchesCondition(rule.conditions, input)) {
      return {
        level: rule.result.level,
        explanation: applyTemplate(rule.result.explanation, vars),
        recommendation: rule.result.recommendation
          ? applyTemplate(rule.result.recommendation, vars)
          : undefined,
      };
    }
  }

  return {
    level: 'low',
    explanation: `${input.category} resource "${input.logicalId}" has minor changes.`,
  };
}
