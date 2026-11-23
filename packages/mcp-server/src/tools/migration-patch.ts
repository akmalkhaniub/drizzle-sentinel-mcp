import { z } from 'zod';
import { lintSqlMigration } from '@drizzle-sentinel/rules-engine';
import { DrizzleSchemaParser } from '../services/drizzle-parser.js';
import { DrizzleColumn } from '../types/index.js';
import { redactSensitiveText, resolveSafeWorkspacePath } from '../security.js';
import { registerGeneratedPatch } from './resources.js';

export const generateMigrationPatchSchema = z.object({
  schemaPath: z.string().min(1).max(512).describe('Workspace-contained path to the declared Drizzle TypeScript schema file.'),
  inlineContent: z.string().max(100_000).optional().describe('Optional inline Drizzle schema TypeScript source.'),
  databaseTables: z.array(z.object({
    name: z.string().min(1).max(128),
    columns: z.array(z.object({
      name: z.string().min(1).max(128),
      type: z.string().min(1).max(128),
      isNullable: z.boolean().default(true)
    }).strict()).max(200)
  }).strict()).max(200).describe('Snapshot of live database tables and columns.'),
  dialect: z.enum(['postgresql', 'sqlite', 'mysql']).default('postgresql'),
  migrationName: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/).default('0001_non_destructive_sync'),
  notNullStrategy: z.enum(['safe-default', 'nullable-expand']).default('safe-default')
}).strict();

export type GenerateMigrationPatchInput = z.input<typeof generateMigrationPatchSchema>;

function mapDrizzleTypeToSql(colType: string, dialect: 'postgresql' | 'sqlite' | 'mysql'): { sqlType: string; safeDefault: string } {
  const normalized = colType.toLowerCase();
  if (normalized === 'uuid') {
    return dialect === 'postgresql'
      ? { sqlType: 'UUID', safeDefault: "'00000000-0000-0000-0000-000000000000'" }
      : { sqlType: 'TEXT', safeDefault: "'00000000-0000-0000-0000-000000000000'" };
  }
  if (normalized === 'integer' || normalized === 'serial' || normalized === 'bigint' || normalized === 'smallint') {
    return { sqlType: 'INTEGER', safeDefault: '0' };
  }
  if (normalized === 'boolean') {
    return dialect === 'sqlite'
      ? { sqlType: 'INTEGER', safeDefault: '0' }
      : { sqlType: 'BOOLEAN', safeDefault: 'FALSE' };
  }
  if (normalized === 'timestamp' || normalized === 'date') {
    return { sqlType: 'TIMESTAMP', safeDefault: 'CURRENT_TIMESTAMP' };
  }
  if (normalized === 'json' || normalized === 'jsonb') {
    return dialect === 'postgresql'
      ? { sqlType: 'JSONB', safeDefault: "'{}'::jsonb" }
      : { sqlType: 'TEXT', safeDefault: "'{}'" };
  }
  if (normalized === 'numeric' || normalized === 'decimal' || normalized === 'real' || normalized === 'doubleprecision') {
    return { sqlType: 'NUMERIC', safeDefault: '0' };
  }
  return { sqlType: 'TEXT', safeDefault: "''" };
}

function quoteIdent(name: string, dialect: 'postgresql' | 'sqlite' | 'mysql'): string {
  return dialect === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

function buildColumnDefinition(col: DrizzleColumn, dialect: 'postgresql' | 'sqlite' | 'mysql'): string {
  const { sqlType, safeDefault } = mapDrizzleTypeToSql(col.type, dialect);
  const ident = quoteIdent(col.name, dialect);
  const parts = [ident, sqlType];
  if (col.isPrimaryKey) {
    parts.push('PRIMARY KEY');
  } else {
    if (col.hasDefault || !col.isNullable) {
      parts.push(`DEFAULT ${safeDefault}`);
    }
    if (!col.isNullable) {
      parts.push('NOT NULL');
    }
  }
  return parts.join(' ');
}

function renderDrizzleTypeScriptMigration(migrationName: string, dialect: string, sqlStatements: string[], advisories: string[]): string {
  const escapedSql = sqlStatements.map(s => s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${'));
  const advisoryComments = advisories.length > 0
    ? advisories.map(a => `// ADVISORY: ${a}`).join('\n') + '\n'
    : '';

  return `import { sql } from 'drizzle-orm';

/**
 * Auto-generated non-destructive Drizzle migration: ${migrationName}
 * Dialect: ${dialect}
 * Guarantee: Expand-only (zero DROP statements, zero lock-inducing NOT NULL without DEFAULT).
 */
${advisoryComments}export const upSql: string[] = [
${escapedSql.map(s => `  \`${s}\``).join(',\n')}
];

export async function up(db: { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> }): Promise<void> {
  for (const statement of upSql) {
    await db.execute(sql.raw(statement));
  }
}
`;
}

export async function handleGenerateMigrationPatch(rawInput: GenerateMigrationPatchInput) {
  try {
    const input = generateMigrationPatchSchema.parse(rawInput);
    const inspection = input.inlineContent
      ? DrizzleSchemaParser.parseContent(input.inlineContent, input.schemaPath)
      : DrizzleSchemaParser.parseFile(resolveSafeWorkspacePath(input.schemaPath, { allowedExtensions: ['.ts', '.mts', '.cts'] }));

    const dbTables = new Map(input.databaseTables.map(t => [t.name, t]));
    const sqlStatements: string[] = [];
    const advisories: string[] = [];

    for (const table of inspection.tables) {
      const tIdent = quoteIdent(table.name, input.dialect);
      const liveTable = dbTables.get(table.name);

      if (!liveTable) {
        const colDefs = table.columns.map(col => `  ${buildColumnDefinition(col, input.dialect)}`).join(',\n');
        sqlStatements.push(`CREATE TABLE IF NOT EXISTS ${tIdent} (\n${colDefs}\n);`);

        for (const col of table.columns) {
          if (col.references) {
            const idxIdent = quoteIdent(`idx_${table.name}_${col.name}`, input.dialect);
            const cIdent = quoteIdent(col.name, input.dialect);
            sqlStatements.push(`CREATE INDEX IF NOT EXISTS ${idxIdent} ON ${tIdent} (${cIdent});`);
          }
        }
        continue;
      }

      const liveCols = new Map(liveTable.columns.map(c => [c.name, c]));
      for (const col of table.columns) {
        if (!liveCols.has(col.name)) {
          const { sqlType, safeDefault } = mapDrizzleTypeToSql(col.type, input.dialect);
          const cIdent = quoteIdent(col.name, input.dialect);

          if (col.isNullable) {
            sqlStatements.push(`ALTER TABLE ${tIdent} ADD COLUMN ${cIdent} ${sqlType};`);
          } else if (input.notNullStrategy === 'nullable-expand' && !col.hasDefault) {
            sqlStatements.push(`ALTER TABLE ${tIdent} ADD COLUMN ${cIdent} ${sqlType};`);
            advisories.push(`Column '${table.name}.${col.name}' added as nullable first; backfill rows then apply SET NOT NULL.`);
          } else {
            sqlStatements.push(`ALTER TABLE ${tIdent} ADD COLUMN ${cIdent} ${sqlType} DEFAULT ${safeDefault} NOT NULL;`);
          }

          if (col.references) {
            const idxIdent = quoteIdent(`idx_${table.name}_${col.name}`, input.dialect);
            const indexClause = input.dialect === 'postgresql' ? 'CREATE INDEX CONCURRENTLY IF NOT EXISTS' : 'CREATE INDEX IF NOT EXISTS';
            sqlStatements.push(`${indexClause} ${idxIdent} ON ${tIdent} (${cIdent});`);
          }
        }
      }

      for (const liveCol of liveTable.columns) {
        if (!table.columns.some(c => c.name === liveCol.name)) {
          advisories.push(`Extra column '${table.name}.${liveCol.name}' exists in DB only; skipped DROP COLUMN (use expand-contract deprecation).`);
        }
      }
    }

    for (const [liveTableName] of dbTables.entries()) {
      if (!inspection.tables.some(t => t.name === liveTableName)) {
        advisories.push(`Extra table '${liveTableName}' exists in DB only; skipped DROP TABLE (archive before manual removal).`);
      }
    }

    const patchSql = sqlStatements.join('\n');
    const issues = patchSql.trim() ? lintSqlMigration(patchSql, input.dialect) : [];
    const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
    const warningCount = issues.filter(i => i.severity === 'WARNING').length;
    const ruleGateStatus = criticalCount > 0 ? 'FAILED' : warningCount > 0 ? 'PASSED_WITH_WARNINGS' : 'PASSED';

    const migrationTypeScript = renderDrizzleTypeScriptMigration(
      input.migrationName,
      input.dialect,
      sqlStatements,
      advisories
    );

    const resourceUri = registerGeneratedPatch(input.migrationName, patchSql, migrationTypeScript);

    const structuredResult = {
      migrationName: input.migrationName,
      dialect: input.dialect,
      hasChanges: sqlStatements.length > 0,
      statementCount: sqlStatements.length,
      ruleGateStatus,
      criticalViolations: criticalCount,
      warningViolations: warningCount,
      patchSql,
      migrationTypeScript,
      advisories,
      resourceUri
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(structuredResult, null, 2)
        },
        {
          type: 'resource_link' as const,
          uri: resourceUri,
          name: `${input.migrationName}.sql`,
          description: `Generated non-destructive ${input.dialect} migration patch (${sqlStatements.length} statement(s))`,
          mimeType: 'application/sql'
        }
      ],
      structuredContent: structuredResult
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Migration patch generation failed: ${redactSensitiveText(error?.message || String(error))}`
        }
      ]
    };
  }
}
