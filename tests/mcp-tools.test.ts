import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { handleInspectSchema, inspectSchemaSchema } from '../packages/mcp-server/src/tools/inspect-schema.js';
import { handleLintMigration } from '../packages/mcp-server/src/tools/lint-migration.js';
import { handleDetectSchemaDrift } from '../packages/mcp-server/src/tools/drift-doctor.js';
import { handleExplainQueryPlan, explainQueryPlanSchema } from '../packages/mcp-server/src/tools/query-sandbox.js';
import { handleGenerateMigrationPatch } from '../packages/mcp-server/src/tools/migration-patch.js';
import { completeArgument, readDrizzleResource } from '../packages/mcp-server/src/tools/resources.js';
import { handleStatelessMcpRequest } from '../packages/mcp-server/src/stateless-router.js';
import { REGISTERED_TOOLS } from '../packages/mcp-server/src/tools/catalog.js';
import { redactSensitiveText } from '../packages/mcp-server/src/security.js';

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
      expect((response as any).structuredContent).toEqual(data);
    });

    it('should block stacked multi-statement SQL injection and EXPLAIN ANALYZE mutations', async () => {
      const stacked = await handleExplainQueryPlan({
        sql: 'SELECT 1; DROP TABLE users;',
        dialect: 'postgresql'
      });
      expect(stacked.isError).toBe(true);
      expect(stacked.content[0].text).toContain('Multi-statement SQL');

      const explainMutate = await handleExplainQueryPlan({
        sql: 'EXPLAIN ANALYZE DELETE FROM users',
        dialect: 'postgresql'
      });
      expect(explainMutate.isError).toBe(true);
      expect(explainMutate.content[0].text).toContain('Forbidden mutating');
    });
  });

  describe('5. Security Hardening, ToolAnnotations & Schema Strictness', () => {
    it('should enforce .strict() schemas, bounds, and workspace path-traversal containment', async () => {
      expect(() =>
        inspectSchemaSchema.parse({ schemaPath: 'apps/demo-service/src/db/schema.ts', unexpectedKey: true })
      ).toThrow();

      expect(() =>
        explainQueryPlanSchema.parse({ sql: 'SELECT 1 LIMIT 1', maxRows: 5000 })
      ).toThrow();

      const trav = await handleInspectSchema({ schemaPath: '../../etc/passwd.ts' });
      expect(trav.isError).toBe(true);
      expect(trav.content[0].text).toContain('Path traversal blocked');

      const badExt = await handleLintMigration({ migrationFilePath: 'package.json', dialect: 'postgresql' });
      expect(badExt.isError).toBe(true);
      expect(badExt.content[0].text).toContain('Unsupported file extension');
    });

    it('should attach ToolAnnotations and additionalProperties:false to all tools and redact credentials', () => {
      expect(REGISTERED_TOOLS).toHaveLength(5);
      for (const tool of REGISTERED_TOOLS) {
        expect(tool.annotations).toEqual({
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false
        });
        expect(tool.inputSchema.additionalProperties).toBe(false);
      }

      const scrubbed = redactSensitiveText('Connection failed for postgres://admin:supersecret@db.internal:5432/prod');
      expect(scrubbed).not.toContain('supersecret');
      expect(scrubbed).toContain('[REDACTED]');
    });
  });

  describe('6. DSM-001 Auto-Patch Generator, Resource Links & Completions', () => {
    it('should generate non-destructive expand-only SQL + Drizzle TS migration and verify with rule engine', async () => {
      const response = await handleGenerateMigrationPatch({
        schemaPath: sampleSchemaPath,
        dialect: 'postgresql',
        migrationName: '0002_sync_orgs_and_invoices',
        databaseTables: [
          {
            name: 'organizations',
            columns: [
              { name: 'id', type: 'uuid', isNullable: false },
              { name: 'name', type: 'text', isNullable: false },
              { name: 'legacy_notes', type: 'text', isNullable: true }
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
          },
          {
            name: 'api_keys',
            columns: [
              { name: 'id', type: 'uuid', isNullable: false },
              { name: 'org_id', type: 'uuid', isNullable: false },
              { name: 'key_hash', type: 'text', isNullable: false },
              { name: 'name', type: 'text', isNullable: false },
              { name: 'created_at', type: 'timestamp', isNullable: false }
            ]
          }
        ]
      });

      expect(response.isError).toBeUndefined();
      const sc = (response as any).structuredContent;
      expect(sc.ruleGateStatus).toBe('PASSED');
      expect(sc.criticalViolations).toBe(0);
      expect(sc.patchSql).toContain('ALTER TABLE "organizations" ADD COLUMN "slug" TEXT DEFAULT \'\' NOT NULL;');
      expect(sc.patchSql).toContain('CREATE TABLE IF NOT EXISTS "invoices"');
      expect(sc.patchSql).not.toContain('DROP COLUMN');
      expect(sc.migrationTypeScript).toContain("import { sql } from 'drizzle-orm';");
      expect(sc.migrationTypeScript).toContain('export async function up(');
      expect(sc.advisories.some((a: string) => a.includes('legacy_notes'))).toBe(true);

      const link = response.content.find((c: any) => c.type === 'resource_link') as any;
      expect(link).toBeDefined();
      expect(link.uri).toBe('drizzle://migrations/patches/0002_sync_orgs_and_invoices.sql');

      const stored = readDrizzleResource(link.uri);
      expect(stored.mimeType).toBe('application/sql');
      expect(stored.text).toContain('CREATE TABLE IF NOT EXISTS "invoices"');
    });

    it('should provide context-aware completion/complete suggestions for dialects and workspace tables', () => {
      const dialectComp = completeArgument({
        ref: { type: 'ref/prompt', name: 'audit_migration' },
        argument: { name: 'dialect', value: 'post' }
      });
      expect(dialectComp.values).toEqual(['postgresql']);

      const tableComp = completeArgument({
        ref: { type: 'ref/prompt', name: 'audit_migration' },
        argument: { name: 'tableName', value: 'inv' }
      });
      expect(tableComp.values).toEqual(['invoices']);
    });
  });

  describe('7. Stateless MCP (2026-07-28) Header Routing, Cacheable tools/list & W3C Trace Context', () => {
    it('should serve cacheable tools/list with ttlMs, ETag, and 304 Not Modified', async () => {
      const first = await handleStatelessMcpRequest({
        method: 'POST',
        headers: { 'Mcp-Method': 'tools/list' },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
      });

      expect(first.status).toBe(200);
      expect(first.headers['MCP-Protocol-Version']).toBe('2026-07-28');
      expect(first.headers['Cache-Control']).toContain('max-age=60');
      expect(first.headers.ETag).toBeDefined();
      expect((first.body?.result as any)._meta.ttlMs).toBe(60000);

      const second = await handleStatelessMcpRequest({
        method: 'POST',
        headers: { 'If-None-Match': first.headers.ETag },
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list' }
      });
      expect(second.status).toBe(304);
    });

    it('should route tools/call via Mcp-Method + Mcp-Name headers and propagate W3C traceparent', async () => {
      const incomingTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
      const parentSpanId = '00f067aa0ba902b7';
      const res = await handleStatelessMcpRequest({
        method: 'POST',
        headers: {
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'inspect_drizzle_schema',
          traceparent: `00-${incomingTraceId}-${parentSpanId}-01`
        },
        body: {
          jsonrpc: '2.0',
          id: 99,
          method: 'tools/call',
          params: {
            name: 'inspect_drizzle_schema',
            arguments: { schemaPath: sampleSchemaPath }
          }
        }
      });

      expect(res.status).toBe(200);
      expect(res.headers['X-Trace-Id']).toBe(incomingTraceId);
      const otel = (res.body?.result as any)._meta.otel;
      expect(otel.trace_id).toBe(incomingTraceId);
      expect(otel.parent_span_id).toBe(parentSpanId);
      expect(otel.span_id).not.toBe(parentSpanId);
      expect(otel.context_source).toBe('http-header');

      const mismatch = await handleStatelessMcpRequest({
        method: 'POST',
        headers: { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'wrong_tool' },
        body: {
          jsonrpc: '2.0',
          id: 100,
          method: 'tools/call',
          params: { name: 'inspect_drizzle_schema', arguments: { schemaPath: sampleSchemaPath } }
        }
      });
      expect(mismatch.status).toBe(400);
    });
  });
});
