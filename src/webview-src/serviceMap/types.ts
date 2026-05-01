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

declare global {
  interface Window {
    __MAPS__: ServiceMap[];
  }
}
