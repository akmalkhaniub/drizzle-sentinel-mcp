# Google Cloud Professional Agentic Architect: Production Improvement Plan
## Repository: drizzle-sentinel-mcp
**Audit Date:** November 6, 2026  
**Target Standard:** Google Cloud Professional Agentic Architect (Domain 2: Using Coding Agents & Secure Sandboxes)

---

### Current Assessment
A TypeScript-native Model Context Protocol (MCP) server for Turborepo and Drizzle ORM codebases, providing schema AST introspection, live-to-declared drift detection, sandboxed read-only query execution, and defensive linting against destructive actions (`DROP TABLE/COLUMN`, unindexed foreign keys).

### Critical Gaps
1. **Missing Hardened Sandbox Container:** While the TypeScript linter restricts queries logically, it lacks a containerized sandbox definition for running autonomous database migrations inside an isolated Google Cloud environment.
2. **Adversarial Security Test Coverage:** Lacks an automated test suite explicitly testing AST evasion techniques (e.g., encoded SQL strings, multi-statement batch escapes).
3. **Antigravity Extension Packaging:** Needs an official Antigravity plugin manifest to allow one-click installation into developer IDEs.

---

### Actionable Implementation Steps

#### 1. Hardened GKE Sandbox Manifest (`deploy/gke-sandbox.yaml`)
Define a secure Kubernetes execution environment utilizing the **gVisor** runtime:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: drizzle-sentinel-sandbox
spec:
  template:
    spec:
      runtimeClassName: gvisor  # Hardened isolation
      containers:
        - name: sentinel-mcp
          image: gcr.io/nexus-corp/drizzle-sentinel-mcp:v1
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            capabilities:
              drop: ["ALL"]
```

#### 2. Automated Adversarial AST Test Suite (`test/adversarial.test.ts`)
Add tests validating that complex SQL injection patterns and destructive statements disguised in template literals are caught by the AST parser before execution.

#### 3. Package as an Antigravity Plugin (`plugin.json`)
Package the tool for Antigravity with declared MCP endpoints and custom slash commands (`/drizzle-lint`, `/drizzle-drift`).
