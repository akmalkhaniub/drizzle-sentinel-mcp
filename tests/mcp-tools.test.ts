import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { handleInspectSchema } from '../packages/mcp-server/src/tools/inspect-schema.js';
import { handleLintMigration } from '../packages/mcp-server/src/tools/lint-migration.js';
import { handleDetectSchemaDrift } from '../packages/mcp-server/src/tools/drift-doctor.js';
import { handleExplainQueryPlan } from '../packages/mcp-server/src/tools/query-sandbox.js';

describe('Drizzle Sentinel MCP Tool Suite', () => {
  const sampleSchemaPath = path.resolve(__dirname, '../apps/demo-service/src/db/schema.ts');

  describe('1. inspect_drizzle_schema', () => {
    it('should parse Drizzle schema and identify tables and columns', async () => {
      const response = await handleInspectSchema({ schemaPath: sampleSchemaPath });
      expect(response.isError).toBeUndefined();

      const data = JSON.parse(response.content[0].text);
      expect(data.totalTables).toBe(4);
      expect(data.tables.map((t: any) => t.name)).toEqual(['organizations', 'users', 'api_keys', 'invoices']);
      
      // Ensure unindexed foreign key is flagged
      expect(data.unindexedForeignKeys).toContain('api_keys.org_id -> organizations.id');
    });
  });

  describe('2. lint_drizzle_migration', () => {
    it('should catch destructive DROP TABLE and DROP COLUMN statements', async () => {
      const unsafeSql = `
        DROP TABLE users;
        ALTER TABLE organizations DROP COLUMN plan;
      `;

      const response = await handleLintMigration({ sqlContent: unsafeSql, dialect: 'postgresql' });
      const data = JSON.parse(response.content[0].text);

      expect(data.status).toBe('FAILED');
      expect(data.criticalCount).toBe(2);
      expect(data.issues.some((i: any) => i.ruleId === 'NO_RAW_DROP_TABLE')).toBe(true);
      expect(data.issues.some((i: any) => i.ruleId === 'NO_RAW_DROP_COLUMN')).toBe(true);
    });

    it('should catch adding NOT NULL column without a DEFAULT', async () => {
      const unsafeSql = `
        ALTER TABLE users ADD COLUMN phone_number text NOT NULL;
      `;

      const response = await handleLintMigration({ sqlContent: unsafeSql, dialect: 'postgresql' });
      const data = JSON.parse(response.content[0].text);

      expect(data.status).toBe('FAILED');
      expect(data.issues.some((i: any) => i.ruleId === 'REQUIRE_DEFAULT_ON_NOT_NULL')).toBe(true);
    });

    it('should pass safe migrations with appropriate defaults', async () => {
      const safeSql = `
        ALTER TABLE users ADD COLUMN phone_number text DEFAULT '' NOT NULL;
        CREATE INDEX idx_users_phone ON users (phone_number);
      `;

      const response = await handleLintMigration({ sqlContent: safeSql, dialect: 'postgresql' });
      const data = JSON.parse(response.content[0].text);

      expect(data.status).toBe('PASSED');
      expect(data.criticalCount).toBe(0);
    });
  });

  describe('3. detect_schema_drift', () => {
    it('should detect missing columns in live database and generate safe migration', async () => {
      const mockDbTables = [
        {
          name: 'organizations',
          columns: [
            { name: 'id', type: 'uuid', isNullable: false },
            { name: 'name', type: 'text', isNullable: false }
            // Missing: slug, plan, createdAt
          ]
        },
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'uuid', isNullable: false },
            { name: 'org_id', type: 'uuid', isNullable: false },
            { name: 'email', type: 'text', isNullable: false },
            { name: 'full_name', type: 'text', isNullable: false },
            { name: 'role', type: 'text', isNullable: false },
            { name: 'is_active', type: 'boolean', isNullable: false },
            { name: 'created_at', type: 'timestamp', isNullable: false }
          ]
        }
      ];

      const response = await handleDetectSchemaDrift({
        schemaPath: sampleSchemaPath,
        databaseTables: mockDbTables
      });

      const data = JSON.parse(response.content[0].text);
      expect(data.hasDrift).toBe(true);
      expect(data.differences.some((d: any) => d.type === 'MISSING_TABLE_IN_DB' && d.tableName === 'invoices')).toBe(true);
      expect(data.differences.some((d: any) => d.type === 'MISSING_COLUMN_IN_DB' && d.columnName === 'slug')).toBe(true);
      expect(data.generatedSafeMigration).toContain('ALTER TABLE "organizations" ADD COLUMN "slug"');
    });
  });

  describe('4. explain_query_plan', () => {
    it('should reject mutating queries for safety', async () => {
      const response = await handleExplainQueryPlan({
        sql: 'DELETE FROM users WHERE id = 1',
        dialect: 'postgresql'
      });

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Execution blocked');
    });

    it('should validate SELECT queries and flag missing LIMIT clause', async () => {
      const response = await handleExplainQueryPlan({
        sql: 'SELECT * FROM users ORDER BY created_at DESC',
        dialect: 'postgresql'
      });

      expect(response.isError).toBeUndefined();
      const data = JSON.parse(response.content[0].text);
      expect(data.status).toBe('VALIDATED_SAFE');
      expect(data.detectedPerformanceSmells).toContain('MISSING_LIMIT: Query does not contain an explicit LIMIT clause. Large result sets may consume excessive memory.');
      expect(data.detectedPerformanceSmells.some((s: string) => s.includes('WILDCARD_PROJECTION'))).toBe(true);
    });
  });
});
