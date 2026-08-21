export type RuleSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface MigrationIssue {
  ruleId: string;
  severity: RuleSeverity;
  message: string;
  statementIndex: number;
  statement: string;
  remediation: string;
}

export interface RuleContext {
  statement: string;
  statementIndex: number;
  previousStatements?: string[];
  databaseDialect?: 'postgresql' | 'sqlite' | 'mysql';
}

export interface MigrationRule {
  id: string;
  name: string;
  severity: RuleSeverity;
  description: string;
  evaluate: (ctx: RuleContext) => MigrationIssue | null;
}

export const MIGRATION_RULES: MigrationRule[] = [
  {
    id: 'NO_RAW_DROP_TABLE',
    name: 'Disallow Unsafe DROP TABLE',
    severity: 'CRITICAL',
    description: 'Dropping a table in a live environment results in immediate and irreversible data loss.',
    evaluate: (ctx) => {
      const regex = /DROP\s+TABLE\s+(IF\s+EXISTS\s+)?["`]?([a-zA-Z0-9_]+)["`]?/i;
      if (regex.test(ctx.statement)) {
        return {
          ruleId: 'NO_RAW_DROP_TABLE',
          severity: 'CRITICAL',
          message: 'Found DROP TABLE statement. Destructive action detected.',
          statementIndex: ctx.statementIndex,
          statement: ctx.statement.trim(),
          remediation: 'Deprecate the table in application code first, verify zero reads/writes via telemetry, and archive before dropping.'
        };
      }
      return null;
    }
  },
  {
    id: 'NO_RAW_DROP_COLUMN',
    name: 'Disallow Instant DROP COLUMN',
    severity: 'CRITICAL',
    description: 'Dropping a column immediately breaks running application instances that still select or insert that field.',
    evaluate: (ctx) => {
      const regex = /ALTER\s+TABLE\s+["`]?([a-zA-Z0-9_]+)["`]?\s+DROP\s+COLUMN/i;
      if (regex.test(ctx.statement)) {
        return {
          ruleId: 'NO_RAW_DROP_COLUMN',
          severity: 'CRITICAL',
          message: 'Found ALTER TABLE DROP COLUMN statement. May break active API instances.',
          statementIndex: ctx.statementIndex,
          statement: ctx.statement.trim(),
          remediation: 'Execute expand-contract migration: 1) Stop reading/writing in app code, 2) Deploy new app version, 3) Drop column in a subsequent migration.'
        };
      }
      return null;
    }
  },
  {
    id: 'REQUIRE_DEFAULT_ON_NOT_NULL',
    name: 'Enforce DEFAULT on NOT NULL Columns',
    severity: 'CRITICAL',
    description: 'Adding a NOT NULL column without a default value fails on tables with existing rows and causes table locking.',
    evaluate: (ctx) => {
      const isAddColumn = /ALTER\s+TABLE\s+.*ADD\s+(COLUMN\s+)?["`]?([a-zA-Z0-9_]+)["`]?/i.test(ctx.statement);
      const isNotNull = /NOT\s+NULL/i.test(ctx.statement);
      const hasDefault = /DEFAULT\s+/i.test(ctx.statement);

      if (isAddColumn && isNotNull && !hasDefault) {
        return {
          ruleId: 'REQUIRE_DEFAULT_ON_NOT_NULL',
          severity: 'CRITICAL',
          message: 'Added NOT NULL column without a DEFAULT clause on an existing table.',
          statementIndex: ctx.statementIndex,
          statement: ctx.statement.trim(),
          remediation: 'Provide a DEFAULT value (e.g., DEFAULT \'\', DEFAULT 0, or DEFAULT NOW()) or create as NULLABLE, backfill data, and then set NOT NULL.'
        };
      }
      return null;
    }
  },
  {
    id: 'NO_UNINDEXED_FOREIGN_KEYS',
    name: 'Detect Missing Index on Foreign Key Reference',
    severity: 'WARNING',
    description: 'Foreign key columns without supporting indexes cause table lock escalation and slow join performance.',
    evaluate: (ctx) => {
      const fkMatch = /FOREIGN\s+KEY\s*\((["`]?([a-zA-Z0-9_]+)["`]?)\)\s*REFERENCES/i.test(ctx.statement) ||
                      /REFERENCES\s+["`]?([a-zA-Z0-9_]+)["`]?/i.test(ctx.statement);
      const isCreateIndex = /CREATE\s+(UNIQUE\s+)?INDEX/i.test(ctx.statement);
      
      if (fkMatch && !isCreateIndex) {
        return {
          ruleId: 'NO_UNINDEXED_FOREIGN_KEYS',
          severity: 'WARNING',
          message: 'Foreign key relationship created. Ensure a corresponding CREATE INDEX statement accompanies this migration.',
          statementIndex: ctx.statementIndex,
          statement: ctx.statement.trim(),
          remediation: 'Add a CREATE INDEX IF NOT EXISTS idx_<table_column> on the foreign key column.'
        };
      }
      return null;
    }
  },
  {
    id: 'WARN_LOCKING_ALTER_TABLE',
    name: 'Warn on Long-Running Lock Alterations',
    severity: 'WARNING',
    description: 'Type conversions or multiple ALTER TABLE clauses can take an AccessExclusiveLock.',
    evaluate: (ctx) => {
      const isTypeChange = /ALTER\s+TABLE\s+.*ALTER\s+COLUMN\s+.*TYPE/i.test(ctx.statement);
      if (isTypeChange) {
        return {
          ruleId: 'WARN_LOCKING_ALTER_TABLE',
          severity: 'WARNING',
          message: 'Column type alteration detected. This may rewrite the table and block concurrent read/write transactions.',
          statementIndex: ctx.statementIndex,
          statement: ctx.statement.trim(),
          remediation: 'For large tables, create a new column, dual-write in the app, backfill in batches, and switch pointers.'
        };
      }
      return null;
    }
  }
];

export function lintSqlMigration(sqlContent: string, dialect: 'postgresql' | 'sqlite' | 'mysql' = 'postgresql'): MigrationIssue[] {
  // Split sql statements by semicolon, ignoring empty lines or comments
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  const issues: MigrationIssue[] = [];

  statements.forEach((stmt, idx) => {
    for (const rule of MIGRATION_RULES) {
      const issue = rule.evaluate({
        statement: stmt,
        statementIndex: idx + 1,
        previousStatements: statements.slice(0, idx),
        databaseDialect: dialect
      });
      if (issue) {
        issues.push(issue);
      }
    }
  });

  return issues;
}
