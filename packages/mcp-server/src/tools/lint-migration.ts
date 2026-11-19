import { z } from 'zod';
import * as fs from 'fs';
import { lintSqlMigration } from '@drizzle-sentinel/rules-engine';
import { redactSensitiveText, resolveSafeWorkspacePath } from '../security.js';

export const lintMigrationSchema = z.object({
  sqlContent: z.string().max(100_000).optional().describe('Raw SQL migration script text to lint.'),
  migrationFilePath: z.string().min(1).max(512).optional().describe('Path to the .sql migration file to lint.'),
  dialect: z.enum(['postgresql', 'sqlite', 'mysql']).default('postgresql').describe('Target database dialect.')
}).strict();

export type LintMigrationInput = z.input<typeof lintMigrationSchema>;

export async function handleLintMigration(rawInput: LintMigrationInput) {
  try {
    const input = lintMigrationSchema.parse(rawInput);
    let sql = input.sqlContent;

    if (!sql && input.migrationFilePath) {
      const safePath = resolveSafeWorkspacePath(input.migrationFilePath, { allowedExtensions: ['.sql'] });
      if (!fs.existsSync(safePath)) {
        throw new Error(`Migration file not found: ${input.migrationFilePath}`);
      }
      sql = fs.readFileSync(safePath, 'utf-8');
    }

    if (!sql) {
      throw new Error('Either sqlContent or migrationFilePath must be provided.');
    }

    const issues = lintSqlMigration(sql, input.dialect);
    const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
    const warningCount = issues.filter(i => i.severity === 'WARNING').length;

    const summary = {
      status: criticalCount > 0 ? 'FAILED' : warningCount > 0 ? 'PASSED_WITH_WARNINGS' : 'PASSED',
      criticalCount,
      warningCount,
      totalIssues: issues.length,
      issues
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(summary, null, 2)
        }
      ],
      structuredContent: summary
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Migration linting failed: ${redactSensitiveText(error?.message || String(error))}`
        }
      ]
    };
  }
}
