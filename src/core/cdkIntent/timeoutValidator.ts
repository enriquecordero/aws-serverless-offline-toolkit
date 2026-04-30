import * as fs from 'fs';
import * as path from 'path';
import { StackIntentFinding } from './stackIntentValidator';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TimeoutConfig {
  logicalId: string;
  timeoutSeconds: number;
}

interface ResourceMap {
  [logicalId: string]: {
    Type: string;
    Properties?: Record<string, unknown>;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number') { return value; }
  if (typeof value === 'string') {
    const n = Number(value);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

function getRefName(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const ref = (value as { Ref?: unknown }).Ref;
    return typeof ref === 'string' ? ref : undefined;
  }
  return undefined;
}

function getGetAttTarget(value: unknown): string | undefined {
  if (value && typeof value === 'object') {
    const att = (value as { 'Fn::GetAtt'?: unknown })['Fn::GetAtt'];
    if (Array.isArray(att) && typeof att[0] === 'string') { return att[0]; }
  }
  return undefined;
}

// ─── Resource timeout extractors ─────────────────────────────────────────────

function extractLambdaTimeouts(resources: ResourceMap): Map<string, TimeoutConfig> {
  const map = new Map<string, TimeoutConfig>();
  for (const [logicalId, r] of Object.entries(resources)) {
    if (r.Type !== 'AWS::Lambda::Function') { continue; }
    const raw = r.Properties?.Timeout;
    const seconds = numericValue(raw) ?? 3; // AWS default
    map.set(logicalId, { logicalId, timeoutSeconds: seconds });
  }
  return map;
}

// API Gateway v1 (RestApi) integration timeout — default 29s, max 29s
function extractApiGwIntegrationTimeouts(resources: ResourceMap): Map<string, { logicalId: string; timeoutMs: number; lambdaRef?: string }> {
  const map = new Map<string, { logicalId: string; timeoutMs: number; lambdaRef?: string }>();
  for (const [logicalId, r] of Object.entries(resources)) {
    if (r.Type !== 'AWS::ApiGateway::Integration') { continue; }
    const props = r.Properties ?? {};
    const raw = props['TimeoutInMillis'];
    const ms = numericValue(raw) ?? 29000;
    const uri = props['Uri'];
    let lambdaRef: string | undefined;
    // URI format: arn:...:lambda:...:function:${FunctionName.Arn}
    if (uri && typeof uri === 'object') {
      const sub = (uri as Record<string, unknown>)['Fn::Sub'];
      if (typeof sub === 'string') {
        const match = sub.match(/\$\{([^.]+)\./);
        if (match) { lambdaRef = match[1]; }
      }
      const join = (uri as Record<string, unknown>)['Fn::Join'];
      if (Array.isArray(join) && Array.isArray(join[1])) {
        for (const part of join[1]) {
          const ref = getGetAttTarget(part) ?? getRefName(part);
          if (ref) { lambdaRef = ref; break; }
        }
      }
    }
    map.set(logicalId, { logicalId, timeoutMs: ms, lambdaRef });
  }
  return map;
}

// AppSync data source request mapping timeout (default 30s)
function extractAppSyncDsTimeouts(resources: ResourceMap): Map<string, { logicalId: string; timeoutSeconds: number; lambdaRef?: string }> {
  const map = new Map<string, { logicalId: string; timeoutSeconds: number; lambdaRef?: string }>();
  for (const [logicalId, r] of Object.entries(resources)) {
    if (r.Type !== 'AWS::AppSync::DataSource') { continue; }
    const props = r.Properties ?? {};
    // HttpConfig or LambdaConfig may carry timeout, but CDK doesn't expose it as a CF property yet.
    // We capture the Lambda ref so we can check the Lambda timeout vs the implicit 30s AppSync limit.
    const lambdaConfig = props['LambdaConfig'] as Record<string, unknown> | undefined;
    const lambdaArn = lambdaConfig?.LambdaFunctionArn;
    const lambdaRef = getGetAttTarget(lambdaArn) ?? getRefName(lambdaArn);
    const seconds = 30; // AppSync maximum resolver timeout
    map.set(logicalId, { logicalId, timeoutSeconds: seconds, lambdaRef });
  }
  return map;
}

// SQS visibility timeout
function extractSqsVisibilityTimeouts(resources: ResourceMap): Map<string, TimeoutConfig> {
  const map = new Map<string, TimeoutConfig>();
  for (const [logicalId, r] of Object.entries(resources)) {
    if (r.Type !== 'AWS::SQS::Queue') { continue; }
    const raw = r.Properties?.VisibilityTimeout;
    const seconds = numericValue(raw) ?? 30; // AWS default
    map.set(logicalId, { logicalId, timeoutSeconds: seconds });
  }
  return map;
}

// Event source mapping: SQS → Lambda
interface EsmMapping { queueRef: string; functionRef: string; logicalId: string; }
function extractSqsLambdaMappings(resources: ResourceMap): EsmMapping[] {
  const mappings: EsmMapping[] = [];
  for (const [logicalId, r] of Object.entries(resources)) {
    if (r.Type !== 'AWS::Lambda::EventSourceMapping') { continue; }
    const props = r.Properties ?? {};
    const eventSourceArn = props['EventSourceArn'];
    const functionName = props['FunctionName'];
    const queueRef = getRefName(eventSourceArn) ?? getGetAttTarget(eventSourceArn);
    const functionRef = getRefName(functionName) ?? getGetAttTarget(functionName);
    if (queueRef && functionRef) {
      mappings.push({ queueRef, functionRef, logicalId });
    }
  }
  return mappings;
}

// ─── Main validator ───────────────────────────────────────────────────────────

function validateTemplate(
  templateFile: string,
  stackName: string,
  findings: StackIntentFinding[]
): void {
  let parsed: { Resources?: ResourceMap };
  try {
    parsed = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
  } catch {
    return;
  }
  const resources = parsed.Resources ?? {};

  const lambdaTimeouts = extractLambdaTimeouts(resources);
  const apiGwIntegrations = extractApiGwIntegrationTimeouts(resources);
  const appSyncDs = extractAppSyncDsTimeouts(resources);
  const sqsQueues = extractSqsVisibilityTimeouts(resources);
  const esmMappings = extractSqsLambdaMappings(resources);

  // ── Check 1: API Gateway integration timeout < Lambda timeout ────────────
  for (const [, integration] of apiGwIntegrations) {
    if (!integration.lambdaRef) { continue; }
    const lambda = lambdaTimeouts.get(integration.lambdaRef);
    if (!lambda) { continue; }
    const integrationSeconds = integration.timeoutMs / 1000;
    if (integrationSeconds < lambda.timeoutSeconds) {
      findings.push({
        severity: 'high',
        code: 'TIMEOUT_APIGW_LESS_THAN_LAMBDA',
        message: `API Gateway integration ${integration.logicalId} timeout (${integrationSeconds}s) is shorter than Lambda ${lambda.logicalId} timeout (${lambda.timeoutSeconds}s). The gateway will return 504 before the Lambda finishes.`,
        stackName,
      });
    }
  }

  // ── Check 2: AppSync data source Lambda timeout > 30s limit ──────────────
  for (const [, ds] of appSyncDs) {
    if (!ds.lambdaRef) { continue; }
    const lambda = lambdaTimeouts.get(ds.lambdaRef);
    if (!lambda) { continue; }
    if (lambda.timeoutSeconds > ds.timeoutSeconds) {
      findings.push({
        severity: 'high',
        code: 'TIMEOUT_APPSYNC_LAMBDA_EXCEEDS_LIMIT',
        message: `Lambda ${lambda.logicalId} timeout (${lambda.timeoutSeconds}s) exceeds the AppSync data source limit (${ds.timeoutSeconds}s) used by ${ds.logicalId}. AppSync will time out the resolver before Lambda finishes.`,
        stackName,
      });
    }
  }

  // ── Check 3: SQS visibility timeout < Lambda timeout ─────────────────────
  for (const mapping of esmMappings) {
    const queue = sqsQueues.get(mapping.queueRef);
    const lambda = lambdaTimeouts.get(mapping.functionRef);
    if (!queue || !lambda) { continue; }
    if (queue.timeoutSeconds < lambda.timeoutSeconds) {
      findings.push({
        severity: 'high',
        code: 'TIMEOUT_SQS_VISIBILITY_LESS_THAN_LAMBDA',
        message: `SQS queue ${queue.logicalId} visibility timeout (${queue.timeoutSeconds}s) is shorter than Lambda ${lambda.logicalId} timeout (${lambda.timeoutSeconds}s). Messages will become visible again before the handler finishes, causing duplicate processing.`,
        stackName,
      });
    }
  }

  // ── Check 4: Lambda timeout at AWS maximum (900s) ─────────────────────────
  for (const [, lambda] of lambdaTimeouts) {
    if (lambda.timeoutSeconds >= 900) {
      findings.push({
        severity: 'medium',
        code: 'TIMEOUT_LAMBDA_AT_MAXIMUM',
        message: `Lambda ${lambda.logicalId} is configured at the maximum timeout (${lambda.timeoutSeconds}s). Verify this is intentional and that all upstream callers can handle a 15-minute execution.`,
        stackName,
      });
    }
  }
}

export function validateTimeouts(workspaceRoots: string[]): StackIntentFinding[] {
  const findings: StackIntentFinding[] = [];

  for (const root of workspaceRoots) {
    const cdkOutPath = path.join(root, 'cdk.out');
    if (!fs.existsSync(cdkOutPath)) { continue; }

    const templateFiles = fs.readdirSync(cdkOutPath)
      .filter(f => f.endsWith('.template.json'))
      .map(f => path.join(cdkOutPath, f));

    for (const templateFile of templateFiles) {
      const stackName = path.basename(templateFile).replace('.template.json', '');
      validateTemplate(templateFile, stackName, findings);
    }
  }

  return findings;
}
