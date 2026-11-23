import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { inspectSchemaSchema, handleInspectSchema } from './tools/inspect-schema.js';
import { lintMigrationSchema, handleLintMigration } from './tools/lint-migration.js';
import { detectSchemaDriftSchema, handleDetectSchemaDrift } from './tools/drift-doctor.js';
import { explainQueryPlanSchema, handleExplainQueryPlan } from './tools/query-sandbox.js';
import { generateMigrationPatchSchema, handleGenerateMigrationPatch } from './tools/migration-patch.js';
import { REGISTERED_TOOLS } from './tools/catalog.js';
import {
  REGISTERED_PROMPTS,
  RESOURCE_TEMPLATES,
  completeArgument,
  getAuditMigrationPrompt,
  listWorkspaceResources,
  readDrizzleResource
} from './tools/resources.js';
import { redactSensitiveText } from './security.js';
import { resolveTraceContext } from './telemetry.js';

export const TOOLS_LIST_CACHE_TTL_MS = 60_000;

export async function dispatchToolCall(
  name: string,
  args: unknown,
  meta?: Record<string, unknown>,
  headers?: Record<string, string | string[] | undefined>
) {
  const trace = resolveTraceContext({ headers, meta });

  try {
    let result: Record<string, any>;
    switch (name) {
      case 'inspect_drizzle_schema': {
        const parsed = inspectSchemaSchema.parse(args);
        result = await handleInspectSchema(parsed);
        break;
      }
      case 'lint_drizzle_migration': {
        const parsed = lintMigrationSchema.parse(args);
        result = await handleLintMigration(parsed);
        break;
      }
      case 'detect_schema_drift': {
        const parsed = detectSchemaDriftSchema.parse(args);
        result = await handleDetectSchemaDrift(parsed);
        break;
      }
      case 'explain_query_plan': {
        const parsed = explainQueryPlanSchema.parse(args);
        result = await handleExplainQueryPlan(parsed);
        break;
      }
      case 'generate_migration_patch': {
        const parsed = generateMigrationPatchSchema.parse(args);
        result = await handleGenerateMigrationPatch(parsed);
        break;
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool requested: ${name}`);
    }

    return {
      ...result,
      _meta: {
        ...(result._meta || {}),
        otel: {
          traceparent: trace.traceparent,
          trace_id: trace.traceId,
          span_id: trace.spanId,
          parent_span_id: trace.parentSpanId ?? null,
          context_source: trace.source
        }
      }
    };
  } catch (error: any) {
    if (error instanceof McpError) {
      throw error;
    }
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Tool execution error: ${redactSensitiveText(error?.message || String(error))}`
        }
      ],
      _meta: {
        otel: {
          traceparent: trace.traceparent,
          trace_id: trace.traceId,
          span_id: trace.spanId,
          parent_span_id: trace.parentSpanId ?? null,
          context_source: trace.source
        }
      }
    };
  }
}

export function createDrizzleSentinelServer(): Server {
  const server = new Server(
    {
      name: 'drizzle-sentinel-mcp',
      version: '1.1.0'
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        completions: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: REGISTERED_TOOLS,
      _meta: {
        ttlMs: TOOLS_LIST_CACHE_TTL_MS,
        specVersion: '2026-07-28'
      }
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args, _meta } = request.params as {
      name: string;
      arguments?: unknown;
      _meta?: Record<string, unknown>;
    };
    return await dispatchToolCall(name, args, _meta);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: listWorkspaceResources()
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: RESOURCE_TEMPLATES
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const content = readDrizzleResource(request.params.uri);
    return {
      contents: [content]
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: REGISTERED_PROMPTS
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    if (request.params.name !== 'audit_migration') {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
    }
    return getAuditMigrationPrompt(request.params.arguments);
  });

  server.setRequestHandler(CompleteRequestSchema, async (request) => {
    return {
      completion: completeArgument(request.params)
    };
  });

  return server;
}
