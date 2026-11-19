# Proposed New Features & 2026 MCP Spec Roadmap (`drizzle-sentinel-mcp`)

**Scope:** Alignment upgrades for Pluralsight *Model Context Protocol: Security and Safety* and *Model Context Protocol: Advanced Features* (complementing [`docs/PRODUCTION_IMPROVEMENT_PLAN_2026-11-06.md`](./PRODUCTION_IMPROVEMENT_PLAN_2026-11-06.md)).  
**Baseline Reviewed:** [`packages/mcp-server/package.json`](../packages/mcp-server/package.json), [`packages/mcp-server/src/index.ts`](../packages/mcp-server/src/index.ts), [`packages/mcp-server/src/tools/inspect-schema.ts`](../packages/mcp-server/src/tools/inspect-schema.ts)

---

## Current Baseline Gaps

- [`packages/mcp-server/package.json`](../packages/mcp-server/package.json#L16) pins `"@modelcontextprotocol/sdk": "^1.6.1"` and [`packages/mcp-server/src/index.ts`](../packages/mcp-server/src/index.ts#L184-L188) only runs over `StdioServerTransport`.
- Tool schemas (for example [`inspectSchemaSchema`](../packages/mcp-server/src/tools/inspect-schema.ts#L4-L7)) use un-bounded `z.string()` fields without `.max()` constraints, `.strict()` unknown-key rejection, or workspace-root path canonicalization before reading files.
- Tool definitions in [`ListToolsRequestSchema`](../packages/mcp-server/src/index.ts#L31-L139) omit MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), and handlers return plain `text` strings rather than `structuredContent` or `resource_link` references.

---

## Priority 1 — Handler & Schema Security Hardening

### 1. Strict Input Schemas & Workspace Path-Traversal Containment
- **Course Mapping:** *Security & Safety* (LO 6)
- **Target Files:** [`packages/mcp-server/src/index.ts`](../packages/mcp-server/src/index.ts), [`packages/mcp-server/src/tools/inspect-schema.ts`](../packages/mcp-server/src/tools/inspect-schema.ts), `lint-migration.ts`, `drift-doctor.ts`, `query-sandbox.ts`
- **Features to Add:**
  - Enforce `.strict()` on all Zod tool input schemas (rejecting unknown arguments both in Zod runtime checks and JSON Schema `additionalProperties: false` advertised in `tools/list`).
  - Add length limits (`z.string().max(...)`), integer bounds (`maxRows: z.number().int().min(1).max(1000)`), and strict extension checks (`.ts`, `.sql`).
  - Add a shared `resolveSafeWorkspacePath(rootDir, userPath)` helper using `fs.realpathSync` / `path.resolve` containment verification so symlink or `../` path traversal payloads are blocked before reading `schemaPath` or `migrationFilePath`.
  - Redact database credentials/connection strings from error payloads and stderr logs before returning tool responses.

### 2. Native MCP `ToolAnnotations` Metadata
- **Course Mapping:** *Security & Safety* (LO 6)
- **Target Files:** [`packages/mcp-server/src/index.ts`](../packages/mcp-server/src/index.ts#L31-L139)
- **Features to Add:**
  - Populate standard MCP `annotations` on all 4 tools:
    - `inspect_drizzle_schema`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`
    - `lint_drizzle_migration`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`
    - `detect_schema_drift`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`
    - `explain_query_plan`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`
  - Add a fifth opt-in write tool (`apply_safe_migration_patch`, marked `readOnlyHint: false`, `destructiveHint: true`) gated by explicit elicitation/confirmation so learners can compare read vs. destructive annotations cleanly.

---

## Priority 2 — Advanced MCP Capabilities & Transport Modernization

### 3. `structuredContent` & `resource_link` Outputs
- **Course Mapping:** *Advanced Features* (LO 4)
- **Target Files:** [`packages/mcp-server/src/tools/inspect-schema.ts`](../packages/mcp-server/src/tools/inspect-schema.ts), `lint-migration.ts`, `drift-doctor.ts`, `query-sandbox.ts`
- **Features to Add:**
  - Return typed `structuredContent` JSON objects (table AST counts, severity-coded lint violations, drift patch plans, and query-plan metrics) alongside concise human/LLM summary text.
  - Expose large schema/migration files as MCP `resources` (`drizzle://schemas/{file}`, `drizzle://migrations/{file}`) and return `resource_link` blocks rather than embedding multi-kilobyte SQL dumps directly in tool responses (demonstrating token-budget optimization).

### 4. Context-Aware Argument Completions (`completion/complete`)
- **Course Mapping:** *Advanced Features* (LO 4)
- **Target Files:** [`packages/mcp-server/src/index.ts`](../packages/mcp-server/src/index.ts)
- **Features to Add:**
  - Register `prompts` and `resources` templates (e.g., `audit_migration` prompt taking `dialect` and `migrationFilePath`, and `drizzle://table/{dialect}/{tableName}` resource template).
  - Implement a `completion/complete` handler offering context-aware suggestions (filtered table names parsed from the workspace schema + dialect list), explicitly paired with strict Zod validation at execution time.

### 5. Dual Transport (`stdio` + Stateless HTTP) & Elicitation Flow
- **Course Mapping:** *Advanced Features* (LO 1, LO 2, LO 3), *Security & Safety* (LO 2, LO 7)
- **Target Files:** [`packages/mcp-server/package.json`](../packages/mcp-server/package.json), [`packages/mcp-server/src/index.ts`](../packages/mcp-server/src/index.ts), `packages/mcp-server/src/http.ts` (new)
- **Features to Add:**
  - Upgrade `@modelcontextprotocol/sdk` from `^1.6.1` to the current 2026 SDK supporting stateless HTTP transport, `structuredContent`, `completions`, and `input-required` / `Tasks`.
  - Keep `stdio` (`StdioServerTransport`) as the zero-OAuth local dev mode while adding a stateless HTTP entry point (`src/http.ts`) with optional OAuth Bearer JWT verification (`READ` vs. `MIGRATE` scopes).
  - Add an `input-required` / form-elicitation confirmation step (`accept`, `decline`, `cancel`) before generating or executing destructive migration remediation patches, with graceful fallback if a client lacks elicitation capability.

---

## Verification Plan

- Expand [`tests/mcp-tools.test.ts`](../tests/mcp-tools.test.ts) (via `vitest`) to cover:
  - Unknown-field schema rejection (`.strict()`), oversized payload limits, and `../` + symlink path-traversal containment.
  - `ToolAnnotations` presence on every tool descriptor.
  - `structuredContent` + `resource_link` output envelopes and `completion/complete` filtering.
  - `input-required` confirmation outcomes (`accept` / `decline` / `cancel`) and client fallback behavior.
