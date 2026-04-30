import * as fs from 'fs';
import * as path from 'path';
import * as chokidar from 'chokidar';
import { buildSchema, GraphQLSchema } from 'graphql';
import { ResolverDefinition } from '../../shared/types';

const APPSYNC_SCHEMA_PREAMBLE = `
scalar AWSDateTime
scalar AWSJSON

directive @aws_iam on OBJECT | FIELD_DEFINITION
directive @aws_cognito_user_pools on OBJECT | FIELD_DEFINITION
directive @aws_subscribe(mutations: [String!]) on FIELD_DEFINITION
`.trim();

export class SchemaLoader {
  private schemaPath: string;
  private resolversDir: string;
  private watcher?: chokidar.FSWatcher;
  private onChangeCallback?: () => void;

  constructor(schemaPath: string, resolversDir?: string) {
    this.schemaPath = schemaPath;
    this.resolversDir = resolversDir ?? path.join(path.dirname(schemaPath), 'resolvers');
  }

  loadSchema(): GraphQLSchema {
    if (!fs.existsSync(this.schemaPath)) {
      throw new Error(`schema.graphql not found at: ${this.schemaPath}`);
    }

    let sdl = '';
    const stat = fs.statSync(this.schemaPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(this.schemaPath)
        .filter(f => f.endsWith('.graphql'))
        .sort();
      if (files.length === 0) {
        throw new Error(`No .graphql files found in schema directory: ${this.schemaPath}`);
      }
      sdl = this.combineSegmentedSchemas(
        files.map(f => fs.readFileSync(path.join(this.schemaPath, f), 'utf-8'))
      );
    } else {
      sdl = this.normalizeSchemaDocument(fs.readFileSync(this.schemaPath, 'utf-8'));
    }

    return buildSchema(sdl);
  }

  private combineSegmentedSchemas(documents: string[]): string {
    const rootTypeCounts = {
      Query: 0,
      Mutation: 0,
      Subscription: 0,
    };

    const normalizedDocs = documents.map(doc => {
      let normalized = this.normalizeSchemaDocument(doc);

      for (const rootType of Object.keys(rootTypeCounts) as Array<keyof typeof rootTypeCounts>) {
        const declaration = new RegExp(`(^|\\n)\\s*type\\s+${rootType}(\\s|@|\\{)`, 'g');
        normalized = normalized.replace(declaration, (match, prefix, suffix) => {
          rootTypeCounts[rootType] += 1;
          if (rootTypeCounts[rootType] === 1) {
            return `${prefix}type ${rootType}${suffix}`;
          }
          return `${prefix}extend type ${rootType}${suffix}`;
        });
      }

      return normalized;
    });

    return `${APPSYNC_SCHEMA_PREAMBLE}\n\n${normalizedDocs.join('\n\n')}`;
  }

  private normalizeSchemaDocument(doc: string): string {
    return doc
      .replace(/^#.*$/gm, '')
      .replace(/\s@aws_cognito_user_pools\b/g, '')
      .replace(/\s@aws_iam\b/g, '')
      .replace(/\s@aws_subscribe\([^)]*\)/g, '')
      .trim();
  }

  loadResolvers(): ResolverDefinition[] {
    if (fs.existsSync(this.resolversDir)) {
      return this.loadResolverFiles();
    }

    const resolverDefsFile = path.join(this.findWorkspaceRoot(), 'lib/constructs/appsync/resolver-definitions.ts');
    if (fs.existsSync(resolverDefsFile)) {
      return this.loadResolverDefinitionsFile(resolverDefsFile);
    }

    return [];
  }

  private loadResolverFiles(): ResolverDefinition[] {
    const resolvers: ResolverDefinition[] = [];

    // Convention: resolvers/<TypeName>.<fieldName>.request.js and .response.js
    const files = fs.readdirSync(this.resolversDir)
      .filter(f => f.endsWith('.js') || f.endsWith('.ts'));

    const grouped: Record<string, Partial<ResolverDefinition>> = {};

    for (const file of files) {
      // Expected: Query.getItem.request.js  or  Mutation.createItem.response.js
      const baseName = file.replace(/\.(js|ts)$/i, '');
      const parts = baseName.split('.');
      if (parts.length < 3) { continue; }

      const [typeName, fieldName, phase] = parts;
      const key = `${typeName}.${fieldName}`;
      if (!grouped[key]) {
        grouped[key] = { typeName, fieldName, dataSource: typeName === 'Query' ? 'QueryDS' : 'MutationDS' };
      }

      const code = fs.readFileSync(path.join(this.resolversDir, file), 'utf-8');
      if (phase === 'request') {
        grouped[key].requestMappingTemplate = code;
      } else if (phase === 'response') {
        grouped[key].responseMappingTemplate = code;
      }
    }

    for (const def of Object.values(grouped)) {
      resolvers.push(def as ResolverDefinition);
    }

    return resolvers;
  }

  private loadResolverDefinitionsFile(filePath: string): ResolverDefinition[] {
    const source = fs.readFileSync(filePath, 'utf-8');
    const objects = this.extractTopLevelObjects(source);
    const out: ResolverDefinition[] = [];

    for (const block of objects) {
      const typeName = this.matchSingleQuoted(block, 'typeName');
      const fieldName = this.matchSingleQuoted(block, 'fieldName');
      const dataSource = this.matchSingleQuoted(block, 'dataSource') ?? 'none';
      const operation = this.matchSingleQuoted(block, 'operation') ?? 'None';
      if (!typeName || !fieldName) {
        continue;
      }

      const staticResponse = this.extractStaticResponseLiteral(block);
      const requestCode = `function request(ctx) { return { operation: '${operation}', key: ctx.arguments ?? {}, attributeValues: ctx.arguments ?? {} }; }`;
      const responseCode = staticResponse
        ? `function response(ctx) {
  const value = ${staticResponse};

  function resolveRuntimeTemplates(input) {
    if (Array.isArray(input)) {
      return input.map(resolveRuntimeTemplates);
    }

    if (input && typeof input === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(input)) {
        out[k] = resolveRuntimeTemplates(v);
      }
      return out;
    }

    if (typeof input !== 'string') {
      return input;
    }

    if (input === '$util.time.nowISO8601()') {
      return $util.time.nowISO8601();
    }
    if (input === '$util.time.nowEpochSeconds()') {
      return $util.time.nowEpochSeconds();
    }
    if (input === '$util.time.nowEpochMilliSeconds()') {
      return $util.time.nowEpochMilliSeconds();
    }
    if (input === '$util.autoId()') {
      return $util.autoId();
    }
    if (input === '$ctx.identity.sub') {
      return ctx.identity && ctx.identity.sub ? ctx.identity.sub : null;
    }

    return input;
  }

  return resolveRuntimeTemplates(value);
}`
        : `function response(ctx) { return ctx.result; }`;

      out.push({
        typeName,
        fieldName,
        dataSource,
        requestMappingTemplate: requestCode,
        responseMappingTemplate: responseCode,
      });
    }

    return out;
  }

  private extractTopLevelObjects(source: string): string[] {
    const arrStart = source.indexOf('export const resolvers');
    if (arrStart === -1) {
      return [];
    }

    const equalsIndex = source.indexOf('=', arrStart);
    const firstBracket = source.indexOf('[', equalsIndex);
    if (firstBracket === -1) {
      return [];
    }

    const objects: string[] = [];
    let depth = 0;
    let current = '';
    let inObject = false;
    for (let i = firstBracket; i < source.length; i++) {
      const ch = source[i];

      if (ch === '{') {
        depth++;
        inObject = true;
      }

      if (inObject) {
        current += ch;
      }

      if (ch === '}') {
        depth--;
        if (inObject && depth === 0) {
          objects.push(current);
          current = '';
          inObject = false;
        }
      }

      if (ch === ']' && depth === 0) {
        break;
      }
    }
    return objects;
  }

  private matchSingleQuoted(block: string, field: string): string | undefined {
    const re = new RegExp(`${field}\\s*:\\s*'([^']+)'`);
    return block.match(re)?.[1];
  }

  private extractStaticResponseLiteral(block: string): string | undefined {
    const marker = 'staticResponse:';
    const idx = block.indexOf(marker);
    if (idx === -1) {
      return undefined;
    }

    let i = idx + marker.length;
    while (i < block.length && /\s/.test(block[i])) {
      i++;
    }

    const startChar = block[i];
    if (startChar === '{' || startChar === '[') {
      const open = startChar;
      const close = open === '{' ? '}' : ']';
      let depth = 0;
      let literal = '';
      for (; i < block.length; i++) {
        const ch = block[i];
        literal += ch;
        if (ch === open) depth++;
        if (ch === close) {
          depth--;
          if (depth === 0) {
            break;
          }
        }
      }
      return literal;
    }

    const end = block.indexOf(',', i);
    if (end === -1) {
      return block.slice(i).trim();
    }
    return block.slice(i, end).trim();
  }

  private findWorkspaceRoot(): string {
    const schemaStat = fs.statSync(this.schemaPath);
    let current = schemaStat.isDirectory() ? this.schemaPath : path.dirname(this.schemaPath);

    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, 'package.json'))) {
        return current;
      }
      current = path.dirname(current);
    }

    return schemaStat.isDirectory() ? this.schemaPath : path.dirname(this.schemaPath);
  }

  watchForChanges(callback: () => void): void {
    this.onChangeCallback = callback;
    const paths = [this.schemaPath, this.resolversDir].filter(fs.existsSync);

    this.watcher = chokidar.watch(paths, { ignoreInitial: true });
    this.watcher.on('all', () => {
      console.log('[SchemaLoader] Change detected — reloading...');
      this.onChangeCallback?.();
    });
  }

  stopWatching(): void {
    this.watcher?.close();
  }
}
