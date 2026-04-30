// ─── AppSync Types ───────────────────────────────────────────────────────────

export type IdentityType = 'apiKey' | 'cognitoUser' | 'iam' | 'admin' | 'guest';

export interface AppSyncIdentity {
  type: IdentityType;
  username?: string;
  groups?: string[];
  sub?: string;
  issuer?: string;
  accountId?: string;
  cognitoIdentityPoolId?: string;
  cognitoIdentityId?: string;
}

export interface AppSyncContext {
  arguments: Record<string, unknown>;
  identity: AppSyncIdentity;
  source: Record<string, unknown> | null;
  result: unknown;
  stash: Record<string, unknown>;
  request: {
    headers: Record<string, string>;
    domainName: string | null;
  };
  info: {
    fieldName: string;
    parentTypeName: string;
    variables: Record<string, unknown>;
  };
  error?: {
    message: string;
    type: string;
  };
  prev?: {
    result: unknown;
  };
}

export interface ResolverDefinition {
  typeName: string;
  fieldName: string;
  requestMappingTemplate?: string; // JS resolver code
  responseMappingTemplate?: string;
  dataSource: string;
}

export interface MockDataSource {
  name: string;
  type: 'NONE' | 'IN_MEMORY' | 'JSON_FILE';
  data?: Record<string, unknown[]>;
  filePath?: string;
}

export interface AppSyncServerConfig {
  port: number;
  schemaPath: string;
  resolversDir?: string;
  dataSources: MockDataSource[];
  identity: AppSyncIdentity;
}

export interface ResolverLog {
  timestamp: string;
  typeName: string;
  fieldName: string;
  phase: 'request' | 'response' | 'error';
  input: unknown;
  output: unknown;
  durationMs: number;
}

// ─── CDK Diff Types ──────────────────────────────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ChangeType = 'added' | 'modified' | 'deleted' | 'replaced';
export type ResourceCategory =
  | 'Lambda'
  | 'DynamoDB'
  | 'IAM'
  | 'S3'
  | 'ApiGateway'
  | 'AppSync'
  | 'KMS'
  | 'SecurityGroup'
  | 'CloudFront'
  | 'Cognito'
  | 'SNS'
  | 'SQS'
  | 'RDS'
  | 'Other';

export interface DiffChange {
  id: string;
  resourceType: string;
  logicalId: string;
  changeType: ChangeType;
  category: ResourceCategory;
  riskLevel: RiskLevel;
  rawLine: string;
  explanation: string;
  recommendation?: string;
  properties?: PropertyChange[];
}

export interface PropertyChange {
  path: string;
  changeType: ChangeType;
  oldValue?: string;
  newValue?: string;
  riskLevel: RiskLevel;
  explanation: string;
}

export interface DiffSummary {
  totalChanges: number;
  added: DiffChange[];
  modified: DiffChange[];
  deleted: DiffChange[];
  replaced: DiffChange[];
  riskCounts: Record<RiskLevel, number>;
  highestRisk: RiskLevel;
  recommendations: string[];
  rawOutput: string;
  timestamp: string;
  stackName?: string;
}
