import * as fs from 'fs';
import * as path from 'path';

interface CfnValue {
  Ref?: string;
  'Fn::GetAtt'?: [string, string];
  'Fn::Sub'?: string | [string, Record<string, unknown>];
  [key: string]: unknown;
}

interface CfnResource {
  Type: string;
  Properties?: Record<string, unknown>;
}

interface CloudFormationTemplate {
  Resources?: Record<string, CfnResource>;
}

export type ServiceNodeType =
  | 'appsync'
  | 'lambda'
  | 'dynamodb'
  | 'cognito'
  | 'sqs'
  | 'sns'
  | 'eventbridge'
  | 'apigateway'
  | 'datasource';

export interface MapNode {
  id: string;
  type: ServiceNodeType;
  label: string;
  cfnType: string;
}

export interface MapEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface ServiceMap {
  stackName: string;
  nodes: MapNode[];
  edges: MapEdge[];
}

const RELEVANT_TYPES: Record<string, ServiceNodeType> = {
  'AWS::AppSync::GraphQLApi': 'appsync',
  'AWS::AppSync::DataSource': 'datasource',
  'AWS::Lambda::Function': 'lambda',
  'AWS::DynamoDB::Table': 'dynamodb',
  'AWS::Cognito::UserPool': 'cognito',
  'AWS::SQS::Queue': 'sqs',
  'AWS::SNS::Topic': 'sns',
  'AWS::Events::Rule': 'eventbridge',
  'AWS::ApiGateway::RestApi': 'apigateway',
  'AWS::ApiGatewayV2::Api': 'apigateway',
};

function resolveLogicalId(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as CfnValue;
  if (typeof v.Ref === 'string') return v.Ref;
  if (Array.isArray(v['Fn::GetAtt']) && v['Fn::GetAtt'].length >= 1) return v['Fn::GetAtt'][0];
  return null;
}

function humanize(logicalId: string): string {
  // Strip trailing CDK hash (6+ uppercase hex chars)
  let name = logicalId.replace(/[A-F0-9]{6,}$/, '');
  // Insert space before each uppercase run following a lowercase
  name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  return name.trim() || logicalId;
}

function getLabel(logicalId: string, resource: CfnResource): string {
  const p = resource.Properties ?? {};
  switch (resource.Type) {
    case 'AWS::AppSync::GraphQLApi':
      return typeof p.Name === 'string' ? p.Name : humanize(logicalId);
    case 'AWS::AppSync::DataSource':
      return typeof p.Name === 'string' ? p.Name : humanize(logicalId);
    case 'AWS::Lambda::Function':
      return typeof p.FunctionName === 'string' ? p.FunctionName : humanize(logicalId);
    case 'AWS::DynamoDB::Table':
      return typeof p.TableName === 'string' ? p.TableName : humanize(logicalId);
    case 'AWS::Cognito::UserPool':
      return typeof p.UserPoolName === 'string' ? p.UserPoolName : humanize(logicalId);
    case 'AWS::SQS::Queue':
      return typeof p.QueueName === 'string' ? p.QueueName : humanize(logicalId);
    case 'AWS::SNS::Topic':
      return typeof p.TopicName === 'string' ? p.TopicName : humanize(logicalId);
    case 'AWS::ApiGateway::RestApi':
    case 'AWS::ApiGatewayV2::Api':
      return typeof p.Name === 'string' ? p.Name : humanize(logicalId);
    default:
      return humanize(logicalId);
  }
}

function parseTemplate(template: CloudFormationTemplate, stackName: string): ServiceMap {
  const resources = template.Resources ?? {};
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const edgeSeen = new Set<string>();

  // First pass — collect nodes
  for (const [id, res] of Object.entries(resources)) {
    const nodeType = RELEVANT_TYPES[res.Type];
    if (!nodeType) continue;
    // Skip NONE datasources (no external connection to show)
    if (res.Type === 'AWS::AppSync::DataSource' && (res.Properties?.Type as string) === 'NONE') continue;
    nodes.push({ id, type: nodeType, label: getLabel(id, res), cfnType: res.Type });
  }

  const nodeIds = new Set(nodes.map(n => n.id));

  function addEdge(source: string, target: string, label: string) {
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return;
    const key = `${source}→${target}:${label}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({ id: key, source, target, label });
  }

  // Second pass — detect edges
  for (const [id, res] of Object.entries(resources)) {
    const p = res.Properties ?? {};

    switch (res.Type) {
      case 'AWS::AppSync::DataSource': {
        const apiId = resolveLogicalId(p.ApiId);
        if (apiId) addEdge(apiId, id, 'datasource');

        if ((p.Type as string) === 'AWS_LAMBDA') {
          const lambdaId = resolveLogicalId((p.LambdaConfig as Record<string, unknown>)?.LambdaFunctionArn);
          if (lambdaId) addEdge(id, lambdaId, 'invokes');
        }
        if ((p.Type as string) === 'AMAZON_DYNAMODB') {
          const tableId = resolveLogicalId((p.DynamoDBConfig as Record<string, unknown>)?.TableName);
          if (tableId) addEdge(id, tableId, 'reads/writes');
        }
        if ((p.Type as string) === 'AMAZON_ELASTICSEARCH' || (p.Type as string) === 'AMAZON_OPENSEARCH_SERVICE') {
          const esId = resolveLogicalId((p.OpenSearchServiceConfig as Record<string, unknown>)?.Endpoint ?? (p.ElasticsearchConfig as Record<string, unknown>)?.Endpoint);
          if (esId) addEdge(id, esId, 'queries');
        }
        break;
      }

      case 'AWS::AppSync::GraphQLApi': {
        // Cognito auth
        const poolId = resolveLogicalId((p.UserPoolConfig as Record<string, unknown>)?.UserPoolId);
        if (poolId) addEdge(poolId, id, 'auth');
        break;
      }

      case 'AWS::Lambda::EventSourceMapping': {
        const sourceId = resolveLogicalId(p.EventSourceArn);
        const funcId = resolveLogicalId(p.FunctionName);
        if (sourceId && funcId) addEdge(sourceId, funcId, 'triggers');
        break;
      }

      case 'AWS::Lambda::Function': {
        // Env var refs to DynamoDB tables
        const vars = (p.Environment as Record<string, unknown>)?.Variables;
        if (vars && typeof vars === 'object') {
          for (const val of Object.values(vars as Record<string, unknown>)) {
            const refId = resolveLogicalId(val);
            if (refId && nodeIds.has(refId)) {
              const target = nodes.find(n => n.id === refId);
              if (target?.type === 'dynamodb' || target?.type === 'sqs' || target?.type === 'sns') {
                addEdge(id, refId, 'env ref');
              }
            }
          }
        }
        break;
      }

      case 'AWS::Events::Rule': {
        const targets = p.Targets as Array<Record<string, unknown>> | undefined;
        for (const t of targets ?? []) {
          const targetId = resolveLogicalId(t.Arn);
          if (targetId) addEdge(id, targetId, 'triggers');
        }
        break;
      }

      case 'AWS::SNS::Topic': {
        const subs = p.Subscription as Array<Record<string, unknown>> | undefined;
        for (const sub of subs ?? []) {
          const endpointId = resolveLogicalId(sub.Endpoint);
          if (endpointId) addEdge(id, endpointId, 'publishes');
        }
        break;
      }
    }
  }

  return { stackName, nodes, edges };
}

export function parseServiceMap(cdkOutDir: string): ServiceMap[] {
  const templates = fs.readdirSync(cdkOutDir)
    .filter(f => f.endsWith('.template.json') && !f.startsWith('manifest'))
    .map(f => ({
      name: path.basename(f, '.template.json'),
      path: path.join(cdkOutDir, f),
    }));

  return templates
    .map(({ name, path: filePath }) => {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const tpl: CloudFormationTemplate = JSON.parse(raw);
        return parseTemplate(tpl, name);
      } catch {
        return null;
      }
    })
    .filter((m): m is ServiceMap => m !== null && m.nodes.length > 0);
}
