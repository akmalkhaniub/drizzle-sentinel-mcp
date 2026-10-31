# AGENTS.md — Autonomous Agent Operating Contract

## 🎯 Repository Purpose & Architecture
`drizzle-sentinel-mcp` is a TypeScript-native Model Context Protocol (MCP) server for Turborepo and Drizzle ORM codebases. It provides schema AST introspection, live-to-declared drift detection, sandboxed read-only query execution, and defensive linting against destructive schema changes.

### Tech Stack
- **Language**: TypeScript (Strict Mode)
- **Frameworks**: MCP SDK, Drizzle ORM, Vitest, Turborepo
- **Key Modules**: `packages/mcp-server`, `packages/schema-engine`

---

## ⚡ Autonomous Execution Protocol
1. Read assigned task from `TASKS.json`.
2. Implement tools adhering to MCP JSON-RPC standards and strict TypeScript typing.
3. Run verification: `pnpm test && pnpm typecheck`.
4. Commit with: `feat(task-id): description`.

## 🛡️ Non-Negotiable Quality Rules
- **No Unsafe DDL**: Any tool detecting `DROP TABLE` or `DROP COLUMN` must flag a critical severity warning.
- **Hermetic Tests**: Unit tests must use mock schema ASTs or in-memory SQLite/pg-mem.
