import * as fs from 'fs';
import * as path from 'path';
import { inMemoryStore } from './dataSources/inMemoryDataSource';

// ─── Load mock-data.json into the in-memory store ─────────────────────────────

export function seedFromJsonFile(filePath: string): { tables: string[]; itemCount: number } {
    if (!fs.existsSync(filePath)) {
        return { tables: [], itemCount: 0 };
    }

    let data: Record<string, unknown[]>;
    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown[]>;
    } catch {
        return { tables: [], itemCount: 0 };
    }

    inMemoryStore.clearAll();

    let itemCount = 0;
    const tables: string[] = [];

    for (const [tableName, items] of Object.entries(data)) {
        if (!Array.isArray(items)) { continue; }
        inMemoryStore.seed(tableName, items as Record<string, unknown>[]);
        tables.push(tableName);
        itemCount += items.length;
    }

    return { tables, itemCount };
}

// ─── Generate skeleton fixtures from cdk.out DynamoDB table definitions ───────

interface AttributeDefinition {
    AttributeName: string;
    AttributeType: 'S' | 'N' | 'B';
}

interface KeySchema {
    AttributeName: string;
    KeyType: 'HASH' | 'RANGE';
}

interface DynamoTableProps {
    TableName?: unknown;
    AttributeDefinitions?: AttributeDefinition[];
    KeySchema?: KeySchema[];
}

function sampleValue(attrType: string): unknown {
    switch (attrType) {
        case 'N': return 1;
        case 'B': return 'base64value';
        default: return 'sample-value';
    }
}

function buildSkeletonItem(keySchema: KeySchema[], attrDefs: AttributeDefinition[]): Record<string, unknown> {
    const item: Record<string, unknown> = { id: 'sample-id-001' };
    for (const key of keySchema) {
        const def = attrDefs.find(a => a.AttributeName === key.AttributeName);
        if (def) {
            item[def.AttributeName] = sampleValue(def.AttributeType);
        }
    }
    return item;
}

export function generateSkeletonsFromCdk(workspaceRoot: string): Record<string, Record<string, unknown>[]> {
    const cdkOutPath = path.join(workspaceRoot, 'cdk.out');
    if (!fs.existsSync(cdkOutPath)) { return {}; }

    const result: Record<string, Record<string, unknown>[]> = {};

    const templateFiles = fs.readdirSync(cdkOutPath)
        .filter(f => f.endsWith('.template.json'))
        .map(f => path.join(cdkOutPath, f));

    for (const templateFile of templateFiles) {
        let parsed: { Resources?: Record<string, { Type: string; Properties?: DynamoTableProps }> };
        try {
            parsed = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
        } catch { continue; }

        for (const [, resource] of Object.entries(parsed.Resources ?? {})) {
            if (resource.Type !== 'AWS::DynamoDB::Table') { continue; }
            const props = resource.Properties ?? {};
            const keySchema = props.KeySchema ?? [];
            const attrDefs = props.AttributeDefinitions ?? [];

            const rawName = props.TableName;
            const tableName = typeof rawName === 'string' ? rawName : 'UnknownTable';

            if (!result[tableName]) {
                result[tableName] = [buildSkeletonItem(keySchema, attrDefs)];
            }
        }
    }

    return result;
}

// ─── Watch mock-data.json and reload on change ────────────────────────────────

export function watchMockDataFile(
    filePath: string,
    onChange: (tables: string[], itemCount: number) => void
): () => void {
    if (!fs.existsSync(filePath)) {
        return () => { /* no-op */ };
    }

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const watcher = fs.watch(filePath, () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const result = seedFromJsonFile(filePath);
            onChange(result.tables, result.itemCount);
        }, 300);
    });

    return () => watcher.close();
}
