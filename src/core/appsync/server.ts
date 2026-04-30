import * as http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  graphql,
  GraphQLSchema,
  GraphQLObjectType,
  isObjectType,
  GraphQLFieldResolver,
  defaultFieldResolver,
  printSchema,
} from 'graphql';
import { AppSyncServerConfig, ResolverDefinition, ResolverLog } from '../../shared/types';
import { SchemaLoader } from './schemaLoader';
import { buildContext } from './contextSimulator';
import { executeResolver } from './resolverEngine';
import { inMemoryStore } from './dataSources/inMemoryDataSource';
import { JsonDataSource } from './dataSources/jsonDataSource';

export class AppSyncOfflineServer {
  private config: AppSyncServerConfig;
  private app: express.Application;
  private server?: http.Server;
  private schema?: GraphQLSchema;
  private resolverDefs: ResolverDefinition[] = [];
  private schemaLoader: SchemaLoader;
  private logs: ResolverLog[] = [];
  private logListeners: Array<(log: ResolverLog) => void> = [];
  private schemaReloadListeners: Array<(sdl: string) => void> = [];

  constructor(config: AppSyncServerConfig) {
    this.config = config;
    this.schemaLoader = new SchemaLoader(config.schemaPath, config.resolversDir);
    this.app = express();
    this.setupMiddleware();
    this.seedDataSources();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', port: this.config.port, timestamp: new Date().toISOString() });
    });

    // GraphQL endpoint
    this.app.post('/graphql', this.handleGraphQL.bind(this));
    this.app.get('/graphql', this.handleGraphQL.bind(this));

    // Logs endpoint (for webview polling)
    this.app.get('/logs', (_req, res) => {
      res.json(this.logs.slice(-100));
    });
  }

  private seedDataSources(): void {
    for (const ds of this.config.dataSources) {
      if (ds.type === 'IN_MEMORY' && ds.data) {
        for (const [table, items] of Object.entries(ds.data)) {
          inMemoryStore.seed(table, items as Record<string, unknown>[]);
        }
      } else if (ds.type === 'JSON_FILE' && ds.filePath) {
        new JsonDataSource(ds.filePath); // seeding happens in constructor
      }
    }
  }

  private buildResolvers(): Record<string, Record<string, GraphQLFieldResolver<unknown, unknown>>> {
    const resolverMap: Record<string, Record<string, GraphQLFieldResolver<unknown, unknown>>> = {};

    if (!this.schema) { return resolverMap; }

    const typeMap = this.schema.getTypeMap();

    for (const [typeName, gqlType] of Object.entries(typeMap)) {
      if (!isObjectType(gqlType) || typeName.startsWith('__')) { continue; }

      const fields = (gqlType as GraphQLObjectType).getFields();
      resolverMap[typeName] = {};

      for (const fieldName of Object.keys(fields)) {
        const resolverDef = this.resolverDefs.find(
          r => r.typeName === typeName && r.fieldName === fieldName
        );

        if (!resolverDef) {
          continue;
        }

        resolverMap[typeName][fieldName] = async (source, args, _context) => {
          const ctx = buildContext({
            fieldName,
            parentTypeName: typeName,
            args: args as Record<string, unknown>,
            source: source as Record<string, unknown> | null,
            identityType: this.config.identity.type,
          });

          const result = await executeResolver({
            typeName,
            fieldName,
            args: args as Record<string, unknown>,
            source: source as Record<string, unknown> | null,
            ctx,
            requestCode: resolverDef?.requestMappingTemplate,
            responseCode: resolverDef?.responseMappingTemplate,
            dataSourceName: resolverDef?.dataSource,
          });

          // Emit logs
          for (const log of result.logs) {
            this.logs.push(log);
            this.logListeners.forEach(fn => fn(log));
          }

          if (result.errors?.length) {
            throw new Error(result.errors[0].message);
          }

          return result.data;
        };
      }
    }

    return resolverMap;
  }

  private async handleGraphQL(req: Request, res: Response): Promise<void> {
    if (!this.schema) {
      res.status(503).json({ errors: [{ message: 'Schema not loaded' }] });
      return;
    }

    try {
      const body = req.method === 'GET' ? req.query : req.body;
      const { query, variables, operationName } = body as {
        query?: string;
        variables?: Record<string, unknown>;
        operationName?: string;
      };

      if (!query) {
        res.status(400).json({ errors: [{ message: 'Missing query' }] });
        return;
      }

      const resolverMap = this.buildResolvers();

      const result = await graphql({
        schema: this.schema,
        source: query,
        rootValue: {},
        variableValues: variables,
        operationName,
        fieldResolver: (source, args, contextValue, info) => {
          const typeResolvers = resolverMap[info.parentType.name];
          const resolver = typeResolvers?.[info.fieldName];
          if (resolver) {
            return resolver(source, args, contextValue, info);
          }
          return defaultFieldResolver(source, args, contextValue, info);
        },
      });

      res.json(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ errors: [{ message: msg }] });
    }
  }

  async start(): Promise<void> {
    this.schema = this.schemaLoader.loadSchema();
    this.resolverDefs = this.schemaLoader.loadResolvers();

    // Hot reload
    this.schemaLoader.watchForChanges(() => {
      try {
        this.schema = this.schemaLoader.loadSchema();
        this.resolverDefs = this.schemaLoader.loadResolvers();
        const sdl = this.getSchemaSDL();
        this.schemaReloadListeners.forEach(fn => fn(sdl));
        console.log('[AppSync Offline] Schema hot-reloaded ✓');
      } catch (err) {
        console.error('[AppSync Offline] Hot reload failed:', err);
      }
    });

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.config.port, () => {
        console.log(`[AppSync Offline] Running at http://localhost:${this.config.port}/graphql`);
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  stop(): void {
    this.schemaLoader.stopWatching();
    this.server?.close();
    this.logs = [];
    console.log('[AppSync Offline] Server stopped');
  }

  onLog(fn: (log: ResolverLog) => void): void {
    this.logListeners.push(fn);
  }

  onSchemaReload(fn: (sdl: string) => void): void {
    this.schemaReloadListeners.push(fn);
  }

  getPort(): number {
    return this.config.port;
  }

  getSchemaSDL(): string {
    return this.schema ? printSchema(this.schema) : '';
  }
}
