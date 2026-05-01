import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validateTimeouts } from '../../../src/core/cdkIntent/timeoutValidator';

interface CfnTemplate {
  Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
}

function makeWorkspace(template: CfnTemplate, stackName = 'TestStack'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-timeout-'));
  const cdkOut = path.join(root, 'cdk.out');
  fs.mkdirSync(cdkOut);
  fs.writeFileSync(path.join(cdkOut, `${stackName}.template.json`), JSON.stringify(template));
  return root;
}

describe('validateTimeouts', () => {
  let createdRoots: string[] = [];

  beforeEach(() => { createdRoots = []; });
  afterEach(() => {
    for (const r of createdRoots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
  });

  function workspace(template: CfnTemplate, stackName?: string): string[] {
    const root = makeWorkspace(template, stackName);
    createdRoots.push(root);
    return [root];
  }

  it('returns no findings for an empty stack', () => {
    const findings = validateTimeouts(workspace({ Resources: {} }));
    expect(findings).toEqual([]);
  });

  it('returns no findings when no cdk.out exists', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-no-cdkout-'));
    createdRoots.push(root);
    const findings = validateTimeouts([root]);
    expect(findings).toEqual([]);
  });

  it('flags API Gateway integration timeout shorter than Lambda timeout', () => {
    const findings = validateTimeouts(workspace({
      Resources: {
        SlowFn: {
          Type: 'AWS::Lambda::Function',
          Properties: { Timeout: 60 },
        },
        ApiInt: {
          Type: 'AWS::ApiGateway::Integration',
          Properties: {
            TimeoutInMillis: 10000,
            Uri: { 'Fn::Sub': 'arn:aws:apigateway:::lambda:path/...:${SlowFn.Arn}/invocations' },
          },
        },
      },
    }));
    expect(findings.some(f => f.code === 'TIMEOUT_APIGW_LESS_THAN_LAMBDA')).toBe(true);
  });

  it('flags AppSync Lambda timeout exceeding the 30s data source limit', () => {
    const findings = validateTimeouts(workspace({
      Resources: {
        ResolverFn: {
          Type: 'AWS::Lambda::Function',
          Properties: { Timeout: 60 },
        },
        AppSyncDs: {
          Type: 'AWS::AppSync::DataSource',
          Properties: {
            LambdaConfig: {
              LambdaFunctionArn: { 'Fn::GetAtt': ['ResolverFn', 'Arn'] },
            },
          },
        },
      },
    }));
    expect(findings.some(f => f.code === 'TIMEOUT_APPSYNC_LAMBDA_EXCEEDS_LIMIT')).toBe(true);
  });

  it('flags SQS visibility timeout shorter than Lambda timeout (duplicate processing risk)', () => {
    const findings = validateTimeouts(workspace({
      Resources: {
        Queue: {
          Type: 'AWS::SQS::Queue',
          Properties: { VisibilityTimeout: 30 },
        },
        WorkerFn: {
          Type: 'AWS::Lambda::Function',
          Properties: { Timeout: 60 },
        },
        Esm: {
          Type: 'AWS::Lambda::EventSourceMapping',
          Properties: {
            EventSourceArn: { 'Fn::GetAtt': ['Queue', 'Arn'] },
            FunctionName: { Ref: 'WorkerFn' },
          },
        },
      },
    }));
    expect(findings.some(f => f.code === 'TIMEOUT_SQS_VISIBILITY_LESS_THAN_LAMBDA')).toBe(true);
  });

  it('flags Lambda at the AWS maximum timeout (900s)', () => {
    const findings = validateTimeouts(workspace({
      Resources: {
        BigFn: {
          Type: 'AWS::Lambda::Function',
          Properties: { Timeout: 900 },
        },
      },
    }));
    expect(findings.some(f => f.code === 'TIMEOUT_LAMBDA_AT_MAXIMUM')).toBe(true);
  });

  it('does NOT flag when API Gateway integration timeout >= Lambda timeout', () => {
    const findings = validateTimeouts(workspace({
      Resources: {
        Fn: { Type: 'AWS::Lambda::Function', Properties: { Timeout: 5 } },
        Int: {
          Type: 'AWS::ApiGateway::Integration',
          Properties: {
            TimeoutInMillis: 29000,
            Uri: { 'Fn::Sub': '...:${Fn.Arn}/...' },
          },
        },
      },
    }));
    expect(findings.filter(f => f.code === 'TIMEOUT_APIGW_LESS_THAN_LAMBDA')).toEqual([]);
  });

  it('does NOT flag when SQS visibility timeout >= Lambda timeout', () => {
    const findings = validateTimeouts(workspace({
      Resources: {
        Q: { Type: 'AWS::SQS::Queue', Properties: { VisibilityTimeout: 120 } },
        Fn: { Type: 'AWS::Lambda::Function', Properties: { Timeout: 60 } },
        Esm: {
          Type: 'AWS::Lambda::EventSourceMapping',
          Properties: {
            EventSourceArn: { 'Fn::GetAtt': ['Q', 'Arn'] },
            FunctionName: { Ref: 'Fn' },
          },
        },
      },
    }));
    expect(findings.filter(f => f.code === 'TIMEOUT_SQS_VISIBILITY_LESS_THAN_LAMBDA')).toEqual([]);
  });

  it('handles malformed templates by skipping silently', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-malformed-'));
    createdRoots.push(root);
    const cdkOut = path.join(root, 'cdk.out');
    fs.mkdirSync(cdkOut);
    fs.writeFileSync(path.join(cdkOut, 'broken.template.json'), '{not valid json');
    expect(() => validateTimeouts([root])).not.toThrow();
  });
});
