# 🛡️ Drizzle Sentinel MCP — Agent Guidelines & Tooling Rules

This file governs how Claude Code, Cursor, and autonomous agents interact with this repository and database migrations.

## 📌 Architecture Philosophy
1. **Never generate naked destructive migrations**:
   - Never use `DROP TABLE` or `DROP COLUMN` in single-phase migrations.
   - Always apply the **Expand-Contract** pattern.
2. **Defensive Schema Design**:
   - Every `NOT NULL` column added to an existing table **must** supply a non-empty `DEFAULT` clause.
   - Every foreign key constraint **must** have an index on the referencing table column.
3. **Strict Zero-Mutation Read Sandbox**:
   - Agents must only use `explain_query_plan` with `SELECT` queries. Data modifications inside automated agent testing loops must occur in isolated transaction rollbacks.

## 🛠️ MCP Tools Usage Reference

| Tool Name | When to Call | Expected Input |
|---|---|---|
| `inspect_drizzle_schema` | Before creating or modifying DB endpoints | `{ "schemaPath": "apps/demo-service/src/db/schema.ts" }` |
| `lint_drizzle_migration` | Immediately after writing a migration `.sql` file | `{ "sqlContent": "ALTER TABLE ...", "dialect": "postgresql" }` |
| `detect_schema_drift` | When checking if DB instance is synchronized | `{ "schemaPath": "...", "databaseTables": [...] }` |
| `explain_query_plan` | When optimizing ORM queries for API endpoints | `{ "sql": "SELECT ... FROM ...", "dialect": "postgresql" }` |

## 🧪 Testing Commands
- Run test suite: `npm test`
- Build packages: `npm run build`
- Typecheck: `npm run lint`
