import { DiffChange, DiffSummary, ChangeType, ResourceCategory, RiskLevel } from '../../shared/types';
import { analyzeRisk } from './riskAnalyzer';

// ─── Resource type to category mapping ───────────────────────────────────────

const RESOURCE_CATEGORY_MAP: Array<[RegExp, ResourceCategory]> = [
  [/AWS::Lambda::Function|AWS::Lambda::EventSourceMapping|AWS::Lambda::Permission/i, 'Lambda'],
  [/AWS::DynamoDB/i, 'DynamoDB'],
  [/AWS::IAM/i, 'IAM'],
  [/AWS::S3/i, 'S3'],
  [/AWS::ApiGateway|AWS::ApiGatewayV2/i, 'ApiGateway'],
  [/AWS::AppSync/i, 'AppSync'],
  [/AWS::KMS/i, 'KMS'],
  [/AWS::EC2::SecurityGroup/i, 'SecurityGroup'],
  [/AWS::CloudFront/i, 'CloudFront'],
  [/AWS::Cognito/i, 'Cognito'],
  [/AWS::SNS/i, 'SNS'],
  [/AWS::SQS/i, 'SQS'],
  [/AWS::RDS/i, 'RDS'],
];

function categorize(resourceType: string): ResourceCategory {
  for (const [pattern, category] of RESOURCE_CATEGORY_MAP) {
    if (pattern.test(resourceType)) { return category; }
  }
  return 'Other';
}

// ─── Parse raw cdk diff output ────────────────────────────────────────────────

export function parseCdkDiff(rawOutput: string, stackName?: string): DiffSummary {
  const lines = rawOutput.split('\n');
  const changes: DiffChange[] = [];
  let changeIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\x1B\[[0-9;]*m/g, '').trim(); // strip ANSI codes

    // CDK diff format: [+] AWS::Lambda::Function MyFunction
    //                  [-] AWS::S3::Bucket MyBucket
    //                  [~] AWS::IAM::Policy MyPolicy
    //                  [!] (replaced) AWS::DynamoDB::Table MyTable

    const addMatch = line.match(/^\[(\+)\]\s+(AWS::[^\s]+)\s+(.+)$/);
    const delMatch = line.match(/^\[(-)\]\s+(AWS::[^\s]+)\s+(.+)$/);
    const modMatch = line.match(/^\[(~)\]\s+(AWS::[^\s]+)\s+(.+)$/);
    const repMatch = line.match(/^\[(!)\].*\(replaced\)\s+(AWS::[^\s]+)\s+(.+)$/);

    const matched = addMatch ?? delMatch ?? modMatch ?? repMatch;
    if (!matched) { continue; }

    const symbol = matched[1];
    const resourceType = matched[2] ?? '';
    const logicalId = matched[3]?.trim() ?? '';

    const changeType: ChangeType = symbol === '+' ? 'added'
      : symbol === '-' ? 'deleted'
      : symbol === '!' ? 'replaced'
      : 'modified';

    const category = categorize(resourceType);
    const risk = analyzeRisk({ changeType, resourceType, category, logicalId, rawLine: line });

    changes.push({
      id: `change-${++changeIndex}`,
      resourceType,
      logicalId,
      changeType,
      category,
      riskLevel: risk.level,
      rawLine: line,
      explanation: risk.explanation,
      recommendation: risk.recommendation,
    });
  }

  // Count by type
  const added = changes.filter(c => c.changeType === 'added');
  const modified = changes.filter(c => c.changeType === 'modified');
  const deleted = changes.filter(c => c.changeType === 'deleted');
  const replaced = changes.filter(c => c.changeType === 'replaced');

  const riskCounts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const c of changes) { riskCounts[c.riskLevel]++; }

  const riskOrder: RiskLevel[] = ['critical', 'high', 'medium', 'low'];
  const highestRisk: RiskLevel = riskOrder.find(r => riskCounts[r] > 0) ?? 'low';

  const recommendations = [
    ...new Set(changes.map(c => c.recommendation).filter(Boolean) as string[])
  ].slice(0, 10);

  return {
    totalChanges: changes.length,
    added, modified, deleted, replaced,
    riskCounts,
    highestRisk,
    recommendations,
    rawOutput,
    timestamp: new Date().toISOString(),
    stackName,
  };
}
