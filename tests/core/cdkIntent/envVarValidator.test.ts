import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateEnvVars } from '../../../src/core/cdkIntent/envVarValidator';

interface CfnTemplate {
  Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
}

function makeWorkspace(template: CfnTemplate, options: { envLocal?: string; stackName?: string } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-envvar-'));
  const cdkOut = path.join(root, 'cdk.out');
  fs.mkdirSync(cdkOut);
  fs.writeFileSync(
    path.join(cdkOut, `${options.stackName ?? 'TestStack'}.template.json`),
    JSON.stringify(template),
  );
  if (options.envLocal !== undefined) {
    fs.writeFileSync(path.join(root, '.env.local'), options.envLocal);
  }
  return root;
}

describe('validateEnvVars', () => {
  let createdRoots: string[] = [];
  beforeEach(() => { createdRoots = []; });
  afterEach(() => {
    for (const r of createdRoots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  function workspace(template: CfnTemplate, options?: { envLocal?: string; stackName?: string }): string[] {
    const root = makeWorkspace(template, options);
    createdRoots.push(root);
    return [root];
  }

  function lambdaWith(env: Record<string, unknown>): CfnTemplate {
    return {
      Resources: {
        TestFn: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            FunctionName: 'test-fn',
            Environment: { Variables: env },
          },
        },
      },
    };
  }

  it('returns empty summary when cdk.out is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-noenvout-'));
    createdRoots.push(root);
    const summary = validateEnvVars([root]);
    expect(summary.lambdasScanned).toBe(0);
    expect(summary.totalVariables).toBe(0);
  });

  it('classifies static strings as resolved', () => {
    const summary = validateEnvVars(workspace(lambdaWith({ DB_NAME: 'orders' })));
    const v = summary.lambdas[0].variables[0];
    expect(v.sourceType).toBe('static');
    expect(v.status).toBe('resolved');
    expect(v.rawValue).toBe('orders');
  });

  it('classifies empty strings as empty (attention)', () => {
    const summary = validateEnvVars(workspace(lambdaWith({ EMPTY_VAR: '' })));
    const v = summary.lambdas[0].variables[0];
    expect(v.sourceType).toBe('empty');
    expect(v.status).toBe('empty');
    expect(summary.attentionCount).toBe(1);
  });

  it('classifies SSM dynamic references as ssm / unresolvable_offline', () => {
    const summary = validateEnvVars(workspace(lambdaWith({
      DB_PASSWORD: '{{resolve:ssm:/app/db/password:1}}',
    })));
    const v = summary.lambdas[0].variables[0];
    expect(v.sourceType).toBe('ssm');
    expect(v.status).toBe('unresolvable_offline');
  });

  it('classifies SecretsManager dynamic references as secrets_manager / unresolvable_offline', () => {
    const summary = validateEnvVars(workspace(lambdaWith({
      API_KEY: '{{resolve:secretsmanager:my/secret:SecretString:api_key}}',
    })));
    const v = summary.lambdas[0].variables[0];
    expect(v.sourceType).toBe('secrets_manager');
    expect(v.status).toBe('unresolvable_offline');
  });

  it('classifies Fn::ImportValue as cross_stack_ref / unresolvable_offline', () => {
    const summary = validateEnvVars(workspace(lambdaWith({
      OTHER_STACK_VAR: { 'Fn::ImportValue': 'OtherStack:ExportName' },
    })));
    const v = summary.lambdas[0].variables[0];
    expect(v.sourceType).toBe('cross_stack_ref');
    expect(v.status).toBe('unresolvable_offline');
  });

  it('classifies Ref / Fn::GetAtt as intrinsic', () => {
    const summary = validateEnvVars(workspace(lambdaWith({
      TABLE_NAME: { Ref: 'OrdersTable' },
      QUEUE_URL: { 'Fn::GetAtt': ['Queue', 'QueueUrl'] },
    })));
    const vars = summary.lambdas[0].variables;
    expect(vars.find(v => v.name === 'TABLE_NAME')?.sourceType).toBe('intrinsic');
    expect(vars.find(v => v.name === 'QUEUE_URL')?.sourceType).toBe('intrinsic');
    // intrinsics do NOT count as attention
    expect(summary.attentionCount).toBe(0);
  });

  it('applies .env.local overrides and marks them as resolved_local', () => {
    const summary = validateEnvVars(workspace(
      lambdaWith({ DB_PASSWORD: '{{resolve:ssm:/app/db/password:1}}' }),
      { envLocal: 'DB_PASSWORD=local-secret\n' },
    ));
    const v = summary.lambdas[0].variables[0];
    expect(v.status).toBe('resolved_local');
    expect(v.localOverride).toBe('local-secret');
    expect(summary.attentionCount).toBe(0);
  });

  it('parses quoted values in .env.local', () => {
    const summary = validateEnvVars(workspace(
      lambdaWith({ FOO: '{{resolve:ssm:/x}}' }),
      { envLocal: 'FOO="quoted value"\n' },
    ));
    expect(summary.lambdas[0].variables[0].localOverride).toBe('quoted value');
  });

  it('skips comments and blank lines in .env.local', () => {
    const summary = validateEnvVars(workspace(
      lambdaWith({ X: '{{resolve:ssm:/x}}' }),
      { envLocal: '# a comment\n\nX=value\n' },
    ));
    expect(summary.lambdas[0].variables[0].localOverride).toBe('value');
  });

  it('counts attention items per lambda and totals them across the summary', () => {
    const summary = validateEnvVars(workspace({
      Resources: {
        FnA: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Environment: {
              Variables: {
                EMPTY: '',
                SSM_VAR: '{{resolve:ssm:/x}}',
                STATIC: 'ok',
              },
            },
          },
        },
        FnB: {
          Type: 'AWS::Lambda::Function',
          Properties: {
            Environment: { Variables: { STATIC2: 'ok' } },
          },
        },
      },
    }));
    expect(summary.totalVariables).toBe(4);
    expect(summary.attentionCount).toBe(2);
    expect(summary.lambdasScanned).toBe(2);
    // sorted: lambda with most attention items first
    expect(summary.lambdas[0].logicalId).toBe('FnA');
  });

  it('handles malformed templates without throwing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-malformed-env-'));
    createdRoots.push(root);
    fs.mkdirSync(path.join(root, 'cdk.out'));
    fs.writeFileSync(path.join(root, 'cdk.out', 'broken.template.json'), 'not json');
    expect(() => validateEnvVars([root])).not.toThrow();
  });
});
