import { describe, it, expect } from 'vitest';
import { analyzeRisk } from '../../../src/core/cdkDiff/riskAnalyzer';
import type { ChangeType, ResourceCategory } from '../../../src/shared/types';

function input(overrides: Partial<{
  changeType: ChangeType;
  resourceType: string;
  category: ResourceCategory;
  logicalId: string;
  rawLine: string;
}> = {}) {
  return {
    changeType: 'modified' as ChangeType,
    resourceType: 'AWS::Generic::Resource',
    category: 'Other' as ResourceCategory,
    logicalId: 'TestResource',
    rawLine: '',
    ...overrides,
  };
}

describe('riskAnalyzer', () => {
  describe('CRITICAL classifications', () => {
    it('flags S3 bucket deletion as CRITICAL with data-loss warning', () => {
      const r = analyzeRisk(input({ changeType: 'deleted', category: 'S3', logicalId: 'AssetsBucket' }));
      expect(r.level).toBe('critical');
      expect(r.explanation).toContain('AssetsBucket');
      expect(r.explanation.toLowerCase()).toContain('data loss');
      expect(r.recommendation).toBeDefined();
    });

    it('flags DynamoDB replacement as CRITICAL', () => {
      const r = analyzeRisk(input({ changeType: 'replaced', category: 'DynamoDB', logicalId: 'OrdersTable' }));
      expect(r.level).toBe('critical');
      expect(r.explanation.toLowerCase()).toContain('replaced');
    });

    it('flags IAM resource with wildcard action as CRITICAL', () => {
      const r = analyzeRisk(input({
        category: 'IAM',
        logicalId: 'AdminRole',
        rawLine: 'Action: "*", Resource: "*"',
      }));
      expect(r.level).toBe('critical');
      expect(r.explanation).toContain('wildcard');
    });

    it('flags KMS key modification as CRITICAL', () => {
      const r = analyzeRisk(input({ changeType: 'modified', category: 'KMS', logicalId: 'MasterKey' }));
      expect(r.level).toBe('critical');
      expect(r.explanation.toLowerCase()).toContain('encryption');
    });

    it('flags S3 bucket gaining public access as CRITICAL', () => {
      const r = analyzeRisk(input({
        changeType: 'modified',
        category: 'S3',
        logicalId: 'PublicBucket',
        rawLine: 'PublicAccessBlockConfiguration: ...',
      }));
      expect(r.level).toBe('critical');
      expect(r.explanation.toLowerCase()).toContain('public');
    });

    it('flags Security Group with 0.0.0.0/0 ingress as CRITICAL', () => {
      const r = analyzeRisk(input({
        changeType: 'modified',
        category: 'SecurityGroup',
        logicalId: 'WebSG',
        rawLine: 'CidrIp: 0.0.0.0/0',
      }));
      expect(r.level).toBe('critical');
      expect(r.explanation).toContain('0.0.0.0/0');
    });
  });

  describe('HIGH classifications', () => {
    it('flags DynamoDB deletion as HIGH', () => {
      const r = analyzeRisk(input({ changeType: 'deleted', category: 'DynamoDB' }));
      expect(r.level).toBe('high');
      expect(r.explanation.toLowerCase()).toContain('data');
    });

    it('flags AppSync modification as HIGH', () => {
      const r = analyzeRisk(input({ changeType: 'modified', category: 'AppSync' }));
      expect(r.level).toBe('high');
      expect(r.explanation.toLowerCase()).toContain('auth mode');
    });

    it('flags API Gateway auth changes as HIGH', () => {
      const r = analyzeRisk(input({
        changeType: 'modified',
        category: 'ApiGateway',
        rawLine: 'AuthorizationType: NONE',
      }));
      expect(r.level).toBe('high');
    });

    it('flags Cognito modification as HIGH', () => {
      const r = analyzeRisk(input({ changeType: 'modified', category: 'Cognito' }));
      expect(r.level).toBe('high');
    });

    it('flags Lambda environment variable changes as HIGH', () => {
      const r = analyzeRisk(input({
        changeType: 'modified',
        category: 'Lambda',
        rawLine: 'Environment: { Variables: { ... } }',
      }));
      expect(r.level).toBe('high');
    });

    it('flags Lambda deletion as HIGH (generic deleted-non-Other rule)', () => {
      const r = analyzeRisk(input({ changeType: 'deleted', category: 'Lambda' }));
      expect(r.level).toBe('high');
    });
  });

  describe('MEDIUM classifications', () => {
    it('flags non-wildcard IAM modification as MEDIUM', () => {
      const r = analyzeRisk(input({ changeType: 'modified', category: 'IAM', rawLine: 'Action: dynamodb:GetItem' }));
      expect(r.level).toBe('medium');
    });

    it('flags Lambda code modification as MEDIUM', () => {
      const r = analyzeRisk(input({ changeType: 'modified', category: 'Lambda' }));
      expect(r.level).toBe('medium');
    });

    it('flags generic resource replacement as MEDIUM', () => {
      const r = analyzeRisk(input({ changeType: 'replaced', category: 'SQS' }));
      expect(r.level).toBe('medium');
      expect(r.explanation.toLowerCase()).toContain('replaced');
    });
  });

  describe('LOW classifications', () => {
    it('flags new resources as LOW', () => {
      const r = analyzeRisk(input({ changeType: 'added', category: 'Lambda' }));
      expect(r.level).toBe('low');
    });

    it('falls through to LOW for unclassified minor changes', () => {
      const r = analyzeRisk(input({ changeType: 'modified', category: 'Other' }));
      expect(r.level).toBe('low');
    });
  });

  describe('rule precedence', () => {
    it('CRITICAL beats HIGH (S3 delete > generic delete-non-Other)', () => {
      const r = analyzeRisk(input({ changeType: 'deleted', category: 'S3' }));
      expect(r.level).toBe('critical');
    });

    it('CRITICAL beats MEDIUM (DynamoDB replace > generic replace)', () => {
      const r = analyzeRisk(input({ changeType: 'replaced', category: 'DynamoDB' }));
      expect(r.level).toBe('critical');
    });

    it('IAM wildcard beats generic IAM medium rule', () => {
      const r = analyzeRisk(input({
        changeType: 'modified',
        category: 'IAM',
        rawLine: 'Action: "*"',
      }));
      expect(r.level).toBe('critical');
    });
  });

  describe('always returns explanation', () => {
    it('includes the logical ID in the explanation', () => {
      const r = analyzeRisk(input({ logicalId: 'MyUniqueResource', changeType: 'added' }));
      expect(r.explanation).toContain('MyUniqueResource');
    });

    it('includes a recommendation for non-trivial findings', () => {
      const r = analyzeRisk(input({ changeType: 'deleted', category: 'S3' }));
      expect(r.recommendation).toBeTruthy();
      expect(r.recommendation!.length).toBeGreaterThan(10);
    });
  });
});
