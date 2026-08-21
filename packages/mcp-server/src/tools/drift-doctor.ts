import { z } from 'zod';
import { DrizzleSchemaParser } from '../services/drizzle-parser.js';

export const detectSchemaDriftSchema = z.object({
  schemaPath: z.string().describe('Path to the declared Drizzle TypeScript schema file.'),
  databaseTables: z.array(z.object({
    name: z.string(),
    columns: z.array(z.object({
      name: z.string(),
      type: z.string(),
      isNullable: z.boolean().default(true)
    }))
  })).describe('Array of current live database tables and columns for comparison.')
});

export type DetectSchemaDriftInput = z.input<typeof detectSchemaDriftSchema>;

export interface SchemaDriftDifference {
  type: 'MISSING_TABLE_IN_DB' | 'EXTRA_TABLE_IN_DB' | 'MISSING_COLUMN_IN_DB' | 'EXTRA_COLUMN_IN_DB' | 'TYPE_MISMATCH';
  tableName: string;
  columnName?: string;
  declared?: string;
  actual?: string;
  remediationSql: string;
}

export async function handleDetectSchemaDrift(rawInput: DetectSchemaDriftInput) {
  try {
    const input = detectSchemaDriftSchema.parse(rawInput);
    const inspection = DrizzleSchemaParser.parseFile(input.schemaPath);
    const declaredTables = new Map(inspection.tables.map(t => [t.name, t]));
    const dbTables = new Map(input.databaseTables.map(t => [t.name, t]));

    const differences: SchemaDriftDifference[] = [];

    // Check declared tables vs DB
    for (const [tableName, declared] of declaredTables.entries()) {
      if (!dbTables.has(tableName)) {
        differences.push({
          type: 'MISSING_TABLE_IN_DB',
          tableName,
          declared: 'EXISTS',
          actual: 'MISSING',
          remediationSql: `-- Table '${tableName}' is declared in schema but missing in database\n-- Run drizzle-kit generate / push to create.`
        });
      } else {
        const liveTable = dbTables.get(tableName)!;
        const liveCols = new Map(liveTable.columns.map(c => [c.name, c]));

        for (const col of declared.columns) {
          if (!liveCols.has(col.name)) {
            const nullableSql = col.isNullable ? '' : ' NOT NULL';
            const defaultSql = col.hasDefault ? ' DEFAULT \'\'' : '';
            differences.push({
              type: 'MISSING_COLUMN_IN_DB',
              tableName,
              columnName: col.name,
              declared: col.type,
              actual: 'MISSING',
              remediationSql: `ALTER TABLE "${tableName}" ADD COLUMN "${col.name}" ${col.type.toUpperCase()}${defaultSql}${nullableSql};`
            });
          }
        }
      }
    }

    // Check DB tables vs declared
    for (const [tableName, liveTable] of dbTables.entries()) {
      if (!declaredTables.has(tableName)) {
        differences.push({
          type: 'EXTRA_TABLE_IN_DB',
          tableName,
          declared: 'MISSING',
          actual: 'EXISTS',
          remediationSql: `-- Table '${tableName}' exists in database but is not in Drizzle schema.\n-- Add definition to schema.ts or verify if deprecated.`
        });
      }
    }

    const hasDrift = differences.length > 0;

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            hasDrift,
            totalDifferences: differences.length,
            differences,
            generatedSafeMigration: differences.map(d => d.remediationSql).join('\n')
          }, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Schema drift analysis failed: ${error.message}`
        }
      ]
    };
  }
}
