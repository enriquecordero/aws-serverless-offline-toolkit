import * as vscode from 'vscode';
import { IdentityType } from './types';

export function getConfig() {
  const cfg = vscode.workspace.getConfiguration('awsToolkit');
  return {
    appsync: {
      port: cfg.get<number>('appsync.port', 4000),
      mockIdentity: cfg.get<IdentityType>('appsync.mockIdentity', 'apiKey'),
      schemaPath: cfg.get<string>('appsync.schemaPath', ''),
      resolversPath: cfg.get<string>('appsync.resolversPath', ''),
      mockDataPath: cfg.get<string>('appsync.mockDataPath', ''),
    },
    cdkDiff: {
      stackName: cfg.get<string>('cdkDiff.stackName', ''),
    },
  };
}
