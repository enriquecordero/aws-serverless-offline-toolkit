import type { ChangeType, ResourceCategory, RiskLevel } from '../../shared/types';
import { buildRuleSet, evaluateRule } from './ruleEngine';

export interface RiskResult {
  level: RiskLevel;
  explanation: string;
  recommendation?: string;
}

interface RiskInput {
  changeType: ChangeType;
  resourceType: string;
  category: ResourceCategory;
  logicalId: string;
  rawLine: string;
}

const defaultRules = buildRuleSet();

export function analyzeRisk(input: RiskInput, workspaceRoots?: string[]): RiskResult {
  const rules = workspaceRoots ? buildRuleSet(workspaceRoots) : defaultRules;
  return evaluateRule(rules, input);
}
