import { AppSyncContext, AppSyncIdentity, IdentityType } from '../../shared/types';

// ─── Mock Identities ──────────────────────────────────────────────────────────

const MOCK_IDENTITIES: Record<IdentityType, AppSyncIdentity> = {
  apiKey: {
    type: 'apiKey',
  },
  cognitoUser: {
    type: 'cognitoUser',
    username: 'mock-user',
    sub: 'mock-sub-1234-abcd-5678',
    groups: ['Users', 'Editors'],
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_MockPool',
  },
  iam: {
    type: 'iam',
    accountId: '123456789012',
    cognitoIdentityPoolId: 'us-east-1:mock-pool-id',
    cognitoIdentityId: 'us-east-1:mock-identity-id',
  },
  admin: {
    type: 'cognitoUser',
    username: 'admin',
    sub: 'admin-sub-0000',
    groups: ['Admins', 'Users'],
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_MockPool',
  },
  guest: {
    type: 'cognitoUser',
    username: 'guest',
    sub: 'guest-sub-9999',
    groups: [],
    issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_MockPool',
  },
};

// ─── Context Builder ──────────────────────────────────────────────────────────

export function buildContext(opts: {
  fieldName: string;
  parentTypeName: string;
  args: Record<string, unknown>;
  source?: Record<string, unknown> | null;
  identityType: IdentityType;
  stash?: Record<string, unknown>;
  prevResult?: unknown;
}): AppSyncContext {
  return {
    arguments: opts.args,
    identity: MOCK_IDENTITIES[opts.identityType],
    source: opts.source ?? null,
    result: null,
    stash: opts.stash ?? {},
    request: {
      headers: {
        'x-api-key': 'mock-api-key-local',
        'content-type': 'application/json',
      },
      domainName: null,
    },
    info: {
      fieldName: opts.fieldName,
      parentTypeName: opts.parentTypeName,
      variables: opts.args,
    },
    prev: opts.prevResult !== undefined ? { result: opts.prevResult } : undefined,
  };
}

// ─── $util helpers (subset of AppSync's built-in $util) ──────────────────────

export const $util = {
  toJson: (obj: unknown) => JSON.stringify(obj),
  parseJson: (str: string) => JSON.parse(str),
  autoId: () => `mock-id-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  time: {
    nowISO8601: () => new Date().toISOString(),
    nowEpochSeconds: () => Math.floor(Date.now() / 1000),
    nowEpochMilliSeconds: () => Date.now(),
  },
  error: (msg: string, type?: string) => {
    throw { message: msg, type: type ?? 'Error' };
  },
  appendError: (msg: string, type?: string) => {
    console.warn(`[AppSync $util.appendError] ${type ?? 'Error'}: ${msg}`);
  },
  isNull: (obj: unknown) => obj === null || obj === undefined,
  isNullOrBlank: (str: unknown) => str === null || str === undefined || str === '',
  defaultIfNull: <T>(val: T | null | undefined, def: T) => val ?? def,
  matches: (pattern: string, str: string) => new RegExp(pattern).test(str),
};
