import * as fs from 'fs';
import * as path from 'path';
import { inMemoryStore } from './inMemoryDataSource';

export class JsonDataSource {
  constructor(filePath: string) {
    this.loadFromFile(filePath);
  }

  private loadFromFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      console.warn(`[JsonDataSource] File not found: ${filePath}`);
      return;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data: Record<string, Record<string, unknown>[]> = JSON.parse(raw);

      for (const [tableName, items] of Object.entries(data)) {
        inMemoryStore.seed(tableName, items);
      }

      console.log(`[JsonDataSource] Loaded ${Object.keys(data).length} table(s) from ${path.basename(filePath)}`);
    } catch (err) {
      console.error(`[JsonDataSource] Error loading ${filePath}: ${err}`);
    }
  }
}
