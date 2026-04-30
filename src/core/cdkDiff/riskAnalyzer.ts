import { ChangeType, ResourceCategory, RiskLevel } from '../../shared/types';

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

// ─── Risk rules (ordered: most specific first) ────────────────────────────────

export function analyzeRisk(input: RiskInput): RiskResult {
  const { changeType, category, logicalId, rawLine } = input;
  const line = rawLine.toLowerCase();

  // ── CRITICAL ──────────────────────────────────────────────────────────────

  if (changeType === 'deleted' && category === 'S3') {
    return {
      level: 'critical',
      explanation: `S3 Bucket "${logicalId}" is being deleted. This may cause permanent data loss.`,
      recommendation: 'Verify the bucket is empty or has a RemovalPolicy.RETAIN. Confirm with the team before deploying.',
    };
  }

  if (changeType === 'replaced' && category === 'DynamoDB') {
    return {
      level: 'critical',
      explanation: `DynamoDB Table "${logicalId}" is being replaced. Replacement destroys all existing data.`,
      recommendation: 'Export the table data first. Consider using a blue/green strategy or adding a RemovalPolicy.',
    };
  }

  if (category === 'IAM' && (line.includes('*') || line.includes('action') && line.includes('*'))) {
    return {
      level: 'critical',
      explanation: `IAM resource "${logicalId}" contains wildcard (*) permissions, granting excessive access.`,
      recommendation: 'Replace wildcards with specific actions and resources. Use least-privilege IAM policies.',
    };
  }

  if (category === 'KMS' && changeType !== 'added') {
    return {
      level: 'critical',
      explanation: `KMS Key "${logicalId}" policy is being modified or deleted. This can break encryption and make data unreadable.`,
      recommendation: 'Review key policy changes carefully. Ensure all encrypted resources retain access.',
    };
  }

  if (category === 'S3' && line.includes('public')) {
    return {
      level: 'critical',
      explanation: `S3 Bucket "${logicalId}" may be gaining public access. This could expose sensitive data.`,
      recommendation: 'Ensure S3 Block Public Access is enabled unless this bucket is intentionally public (e.g., static website).',
    };
  }

  if (category === 'SecurityGroup' && line.includes('0.0.0.0/0')) {
    return {
      level: 'critical',
      explanation: `Security Group "${logicalId}" allows traffic from 0.0.0.0/0 (open to the internet).`,
      recommendation: 'Restrict ingress rules to known IP ranges or VPC CIDRs.',
    };
  }

  // ── HIGH ──────────────────────────────────────────────────────────────────

  if (changeType === 'deleted' && category === 'DynamoDB') {
    return {
      level: 'high',
      explanation: `DynamoDB Table "${logicalId}" is being deleted. All data will be lost.`,
      recommendation: 'Back up the table before deleting. Set RemovalPolicy.RETAIN for production tables.',
    };
  }

  if (category === 'AppSync' && changeType !== 'added') {
    return {
      level: 'high',
      explanation: `AppSync resource "${logicalId}" is being modified. Auth mode changes can break existing API clients.`,
      recommendation: 'Review auth mode and resolver changes. Test API clients after deployment.',
    };
  }

  if (category === 'ApiGateway' && line.includes('auth')) {
    return {
      level: 'high',
      explanation: `API Gateway "${logicalId}" authorization config is being changed. Endpoints may become exposed.`,
      recommendation: 'Confirm the desired auth configuration and test endpoints after deployment.',
    };
  }

  if (category === 'Cognito' && changeType !== 'added') {
    return {
      level: 'high',
      explanation: `Cognito resource "${logicalId}" is being modified. User pool changes can affect authentication flows.`,
      recommendation: 'Test login/signup flows after deployment. Some changes require user re-authentication.',
    };
  }

  if (category === 'Lambda' && line.includes('environment')) {
    return {
      level: 'high',
      explanation: `Lambda function "${logicalId}" environment variables are changing. Secret or config values may be affected.`,
      recommendation: 'Verify that new environment variables are correct and secrets are properly managed in SSM or Secrets Manager.',
    };
  }

  if (changeType === 'deleted' && category !== 'Other') {
    return {
      level: 'high',
      explanation: `${category} resource "${logicalId}" is being deleted. Dependent services may be affected.`,
      recommendation: 'Confirm no other services depend on this resource before deploying.',
    };
  }

  // ── MEDIUM ────────────────────────────────────────────────────────────────

  if (category === 'IAM') {
    return {
      level: 'medium',
      explanation: `IAM resource "${logicalId}" is being ${changeType}. Permission changes can affect service access.`,
      recommendation: 'Review the diff carefully. Ensure least-privilege is maintained.',
    };
  }

  if (category === 'Lambda' && changeType === 'modified') {
    return {
      level: 'medium',
      explanation: `Lambda function "${logicalId}" is being updated.`,
      recommendation: 'Verify the new code is tested. Consider using Lambda aliases for gradual deployment.',
    };
  }

  if (changeType === 'replaced') {
    return {
      level: 'medium',
      explanation: `Resource "${logicalId}" (${input.resourceType}) is being replaced, causing downtime during deployment.`,
      recommendation: 'Replacing a resource causes it to be deleted and re-created. Plan for downtime.',
    };
  }

  // ── LOW ───────────────────────────────────────────────────────────────────

  if (changeType === 'added') {
    return {
      level: 'low',
      explanation: `New ${category} resource "${logicalId}" will be created.`,
    };
  }

  return {
    level: 'low',
    explanation: `${category} resource "${logicalId}" has minor changes.`,
  };
}
