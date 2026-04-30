import * as fs from 'fs';
import * as path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VarSourceType =
  | 'static'          // plain string, non-empty
  | 'ssm'             // resolve:ssm:/path or {{resolve:ssm:...}}
  | 'secrets_manager' // {{resolve:secretsmanager:...}}
  | 'cross_stack_ref' // Fn::ImportValue
  | 'intrinsic'       // Ref / Fn::GetAtt / Fn::Sub / other CDK token
  | 'empty';          // explicit empty string

export type VarStatus =
  | 'resolved'             // static value present
  | 'resolved_local'       // overridden by .env.local
  | 'unresolvable_offline' // SSM / SecretsManager / ImportValue — needs cloud
  | 'intrinsic'            // CDK intrinsic, resolved at synth/deploy (generally fine)
  | 'empty';               // empty string — likely a misconfiguration

export interface EnvVarEntry {
  name: string;
  sourceType: VarSourceType;
  status: VarStatus;
  rawValue: string;   // human-readable representation of the template value
  localOverride?: string;
}

export interface LambdaEnvReport {
  logicalId: string;
  functionName: string | undefined;
  stackName: string;
  variables: EnvVarEntry[];
  attentionCount: number; // empty + unresolvable_offline
}

export interface EnvVarSummary {
  lambdasScanned: number;
  totalVariables: number;
  attentionCount: number;
  lambdas: LambdaEnvReport[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifyValue(value: unknown): { sourceType: VarSourceType; rawValue: string } {
  if (value === undefined || value === null) {
    return { sourceType: 'empty', rawValue: '' };
  }

  // Intrinsic function object (CDK token / CloudFormation reference)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('Fn::ImportValue' in obj) {
      return { sourceType: 'cross_stack_ref', rawValue: `Fn::ImportValue: ${JSON.stringify(obj['Fn::ImportValue'])}` };
    }
    // Any other intrinsic (Ref, Fn::GetAtt, Fn::Sub, Fn::Select, etc.)
    const key = Object.keys(obj)[0] ?? 'unknown';
    return { sourceType: 'intrinsic', rawValue: `${key}: ${JSON.stringify(obj[key])}` };
  }

  const str = String(value);

  if (str === '') {
    return { sourceType: 'empty', rawValue: '' };
  }

  // Dynamic SSM resolution syntax (CloudFormation dynamic references)
  if (/^\{\{resolve:ssm:/i.test(str) || /^resolve:ssm:/i.test(str)) {
    return { sourceType: 'ssm', rawValue: str };
  }

  // Dynamic SecretsManager resolution syntax
  if (/^\{\{resolve:secretsmanager:/i.test(str)) {
    return { sourceType: 'secrets_manager', rawValue: str };
  }

  return { sourceType: 'static', rawValue: str };
}

function resolveStatus(sourceType: VarSourceType, localOverride: string | undefined): VarStatus {
  if (localOverride !== undefined) { return 'resolved_local'; }
  switch (sourceType) {
    case 'static':          return 'resolved';
    case 'empty':           return 'empty';
    case 'ssm':
    case 'secrets_manager':
    case 'cross_stack_ref': return 'unresolvable_offline';
    case 'intrinsic':       return 'intrinsic';
  }
}

function loadLocalOverrides(workspaceRoot: string): Map<string, string> {
  const overrides = new Map<string, string>();
  const envLocalPath = path.join(workspaceRoot, '.env.local');
  if (!fs.existsSync(envLocalPath)) { return overrides; }

  const lines = fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) { continue; }
    const sep = trimmed.indexOf('=');
    if (sep <= 0) { continue; }
    const key = trimmed.slice(0, sep).trim();
    let val = trimmed.slice(sep + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    overrides.set(key, val);
  }
  return overrides;
}

function extractFunctionName(props: Record<string, unknown>): string | undefined {
  const name = props['FunctionName'];
  if (typeof name === 'string') { return name; }
  if (name && typeof name === 'object') {
    // Fn::Sub or similar
    const obj = name as Record<string, unknown>;
    if ('Fn::Sub' in obj) {
      return String(obj['Fn::Sub']).replace(/\$\{[^}]+\}/g, '*');
    }
  }
  return undefined;
}

// ─── Main validator ───────────────────────────────────────────────────────────

function findTemplateFiles(workspaceRoot: string): string[] {
  const cdkOutPath = path.join(workspaceRoot, 'cdk.out');
  if (!fs.existsSync(cdkOutPath)) { return []; }
  return fs.readdirSync(cdkOutPath)
    .filter(f => f.endsWith('.template.json'))
    .map(f => path.join(cdkOutPath, f));
}

export function validateEnvVars(workspaceRoots: string[]): EnvVarSummary {
  const lambdas: LambdaEnvReport[] = [];

  for (const root of workspaceRoots) {
    const localOverrides = loadLocalOverrides(root);
    const templateFiles = findTemplateFiles(root);

    for (const templateFile of templateFiles) {
      let parsed: { Resources?: Record<string, { Type: string; Properties?: Record<string, unknown> }> };
      try {
        parsed = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
      } catch {
        continue;
      }

      const stackName = path.basename(templateFile).replace('.template.json', '');
      const resources = parsed.Resources ?? {};

      for (const [logicalId, resource] of Object.entries(resources)) {
        if (resource.Type !== 'AWS::Lambda::Function') { continue; }

        const props = resource.Properties ?? {};
        const envBlock = props['Environment'] as { Variables?: Record<string, unknown> } | undefined;
        const rawVars = envBlock?.Variables ?? {};

        const variables: EnvVarEntry[] = Object.entries(rawVars).map(([name, value]) => {
          const { sourceType, rawValue } = classifyValue(value);
          const localOverride = localOverrides.get(name);
          const status = resolveStatus(sourceType, localOverride);
          return { name, sourceType, status, rawValue, localOverride };
        });

        const attentionCount = variables.filter(
          v => v.status === 'empty' || v.status === 'unresolvable_offline'
        ).length;

        lambdas.push({
          logicalId,
          functionName: extractFunctionName(props),
          stackName,
          variables,
          attentionCount,
        });
      }
    }
  }

  // Sort: lambdas with most attention items first
  lambdas.sort((a, b) => b.attentionCount - a.attentionCount);

  const totalVariables = lambdas.reduce((sum, l) => sum + l.variables.length, 0);
  const attentionCount = lambdas.reduce((sum, l) => sum + l.attentionCount, 0);

  return {
    lambdasScanned: lambdas.length,
    totalVariables,
    attentionCount,
    lambdas,
  };
}
