import * as fs from 'fs';
import { DrizzleTable, DrizzleColumn, DrizzleIndex, SchemaInspectionResult } from '../types/index.js';

export class DrizzleSchemaParser {
  /**
   * Parse a Drizzle TypeScript schema file to extract structured table metadata
   */
  public static parseFile(filePath: string): SchemaInspectionResult {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Schema file not found at path: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return this.parseContent(content, filePath);
  }

  public static parseContent(content: string, filePath: string = 'inline-schema.ts'): SchemaInspectionResult {
    const tables: DrizzleTable[] = [];
    let detectedDialect: 'postgresql' | 'sqlite' | 'mysql' = 'postgresql';

    if (content.includes('sqliteTable') || content.includes('drizzle-orm/sqlite-core')) {
      detectedDialect = 'sqlite';
    } else if (content.includes('mysqlTable') || content.includes('drizzle-orm/mysql-core')) {
      detectedDialect = 'mysql';
    }

    // Pattern to match: export const [varName] = [dialect]Table('[tableName]', { ... }, (table) => [...])
    const tableRegex = /export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*(pgTable|sqliteTable|mysqlTable)\s*\(\s*['"`]([a-zA-Z0-9_]+)['"`]\s*,\s*\{([\s\S]*?)\}(?:\s*,\s*\(.*?\)\s*=>\s*(\[[\s\S]*?\]|\{[\s\S]*?\}))?\s*\)/g;

    let match: RegExpExecArray | null;
    while ((match = tableRegex.exec(content)) !== null) {
      const varName = match[1];
      const tableFunc = match[2];
      const tableName = match[3];
      const columnBlock = match[4];
      const indexBlock = match[5] || '';

      const dialect = tableFunc.startsWith('sqlite')
        ? 'sqlite'
        : tableFunc.startsWith('mysql')
        ? 'mysql'
        : 'postgresql';

      const columns = this.parseColumns(columnBlock);
      const indexes = this.parseIndexes(indexBlock);
      const primaryKeys = columns.filter(c => c.isPrimaryKey).map(c => c.name);

      tables.push({
        name: tableName,
        variableName: varName,
        dialect,
        columns,
        indexes,
        primaryKeys
      });
    }

    // Collect all foreign keys that lack an index
    const unindexedForeignKeys: string[] = [];
    for (const table of tables) {
      const indexedCols = new Set<string>();
      table.indexes.forEach(idx => idx.columns.forEach(c => indexedCols.add(c)));
      table.primaryKeys.forEach(pk => indexedCols.add(pk));

      for (const col of table.columns) {
        if (col.references && !indexedCols.has(col.name)) {
          unindexedForeignKeys.push(`${table.name}.${col.name} -> ${col.references}`);
        }
      }
    }

    const totalColumns = tables.reduce((acc, t) => acc + t.columns.length, 0);

    return {
      filePath,
      dialect: detectedDialect,
      tables,
      totalTables: tables.length,
      totalColumns,
      unindexedForeignKeys
    };
  }

  private static parseColumns(columnBlock: string): DrizzleColumn[] {
    const columns: DrizzleColumn[] = [];
    const lines = columnBlock.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('/*')) continue;

      // Match: colName: text('db_col_name').notNull().default(...)
      const colMatch = line.match(/^([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)\s*\(\s*(?:['"`]([a-zA-Z0-9_]+)['"`])?(.*?)\)(.*)/);
      if (colMatch) {
        const jsName = colMatch[1];
        const colType = colMatch[2];
        const dbName = colMatch[3] || jsName;
        const remainingDef = (colMatch[4] + colMatch[5]);

        const isNullable = !remainingDef.includes('.notNull()');
        const hasDefault = remainingDef.includes('.default(') || remainingDef.includes('.$defaultFn(');
        const isPrimaryKey = remainingDef.includes('.primaryKey()');

        let references: string | undefined;
        const refMatch = remainingDef.match(/\.references\(\s*\(\)\s*=>\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/);
        if (refMatch) {
          references = `${refMatch[1]}.${refMatch[2]}`;
        }

        columns.push({
          name: dbName,
          type: colType,
          isNullable,
          hasDefault,
          isPrimaryKey,
          references
        });
      }
    }

    return columns;
  }

  private static parseIndexes(indexBlock: string): DrizzleIndex[] {
    const indexes: DrizzleIndex[] = [];
    if (!indexBlock) return indexes;

    // Matches: index('name').on(table.col1, table.col2) or uniqueIndex('name').on(...)
    const idxRegex = /(index|uniqueIndex)\s*\(\s*['"`]([a-zA-Z0-9_]+)['"`]\s*\)\s*\.on\s*\((.*?)\)/g;
    let match: RegExpExecArray | null;

    while ((match = idxRegex.exec(indexBlock)) !== null) {
      const isUnique = match[1] === 'uniqueIndex';
      const indexName = match[2];
      const colsRaw = match[3];

      const columns = colsRaw
        .split(',')
        .map(c => c.trim().replace(/^table\./, '').replace(/^['"`]|['"`]$/g, ''))
        .filter(c => c.length > 0);

      indexes.push({
        name: indexName,
        columns,
        isUnique
      });
    }

    return indexes;
  }
}
