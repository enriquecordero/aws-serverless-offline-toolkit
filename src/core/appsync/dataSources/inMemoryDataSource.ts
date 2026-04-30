import { $util } from '../contextSimulator';

export class InMemoryDataSource {
  private store: Map<string, Map<string, Record<string, unknown>>> = new Map();

  // Initialize a table with optional seed data
  seed(tableName: string, items: Record<string, unknown>[]): void {
    if (!this.store.has(tableName)) {
      this.store.set(tableName, new Map());
    }
    const table = this.store.get(tableName)!;
    for (const item of items) {
      const key = (item['id'] as string) ?? $util.autoId();
      table.set(key, { ...item, id: key });
    }
  }

  getItem(tableName: string, key: string): Record<string, unknown> | null {
    return this.store.get(tableName)?.get(key) ?? null;
  }

  putItem(tableName: string, item: Record<string, unknown>): Record<string, unknown> {
    if (!this.store.has(tableName)) {
      this.store.set(tableName, new Map());
    }
    const id = (item['id'] as string) ?? $util.autoId();
    const newItem = { ...item, id };
    this.store.get(tableName)!.set(id, newItem);
    return newItem;
  }

  deleteItem(tableName: string, key: string): Record<string, unknown> | null {
    const table = this.store.get(tableName);
    if (!table) { return null; }
    const item = table.get(key) ?? null;
    table.delete(key);
    return item;
  }

  updateItem(tableName: string, key: string, updates: Record<string, unknown>): Record<string, unknown> | null {
    const table = this.store.get(tableName);
    if (!table?.has(key)) { return null; }
    const updated = { ...table.get(key)!, ...updates, id: key };
    table.set(key, updated);
    return updated;
  }

  listItems(tableName: string, filter?: (item: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    const table = this.store.get(tableName);
    if (!table) { return []; }
    const items = Array.from(table.values());
    return filter ? items.filter(filter) : items;
  }

  scan(tableName: string): Record<string, unknown>[] {
    return this.listItems(tableName);
  }

  hasTable(tableName: string): boolean {
    return this.store.has(tableName);
  }

  tableNames(): string[] {
    return Array.from(this.store.keys());
  }

  findByAttributes(tableName: string, attrs: Record<string, unknown>): Record<string, unknown> | null {
    const table = this.store.get(tableName);
    if (!table) { return null; }

    for (const item of table.values()) {
      let match = true;
      for (const [k, v] of Object.entries(attrs)) {
        if (item[k] !== v) {
          match = false;
          break;
        }
      }
      if (match) {
        return item;
      }
    }
    return null;
  }
}

// Singleton instance shared across the server session
export const inMemoryStore = new InMemoryDataSource();
