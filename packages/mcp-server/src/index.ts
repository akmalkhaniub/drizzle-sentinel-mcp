#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

import { inspectSchemaSchema, handleInspectSchema } from './tools/inspect-schema.js';
import { lintMigrationSchema, handleLintMigration } from './tools/lint-migration.js';
import { detectSchemaDriftSchema, handleDetectSchemaDrift } from './tools/drift-doctor.js';
import { explainQueryPlanSchema, handleExplainQueryPlan } from './tools/query-sandbox.js';
import { REGISTERED_TOOLS } from './tools/catalog.js';
import { redactSensitiveText } from './security.js';

const server = new Server(
  {
    name: 'drizzle-sentinel-mcp',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

/**
 * Register available MCP tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: REGISTERED_TOOLS
  };
});

/**
 * Handle tool execution requests
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'inspect_drizzle_schema': {
        const parsed = inspectSchemaSchema.parse(args);
        return await handleInspectSchema(parsed);
      }
      case 'lint_drizzle_migration': {
        const parsed = lintMigrationSchema.parse(args);
        return await handleLintMigration(parsed);
      }
      case 'detect_schema_drift': {
        const parsed = detectSchemaDriftSchema.parse(args);
        return await handleDetectSchemaDrift(parsed);
      }
      case 'explain_query_plan': {
        const parsed = explainQueryPlanSchema.parse(args);
        return await handleExplainQueryPlan(parsed);
      }
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool requested: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool execution error: ${redactSensitiveText(error?.message || String(error))}`
        }
      ]
    };
  }
});

/**
 * Start the MCP server using stdio transport
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 Drizzle Sentinel MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal MCP Server error:', error);
  process.exit(1);
});
