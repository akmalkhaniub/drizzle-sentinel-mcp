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
    tools: [
      {
        name: 'inspect_drizzle_schema',
        description: 'Deeply parses TypeScript Drizzle ORM schema files. Extracts table definitions, columns, data types, nullability, defaults, primary/foreign keys, and alerts on missing indexes.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaPath: {
              type: 'string',
              description: 'Absolute or relative path to the Drizzle schema TypeScript file.'
            },
            inlineContent: {
              type: 'string',
              description: 'Optional inline TypeScript Drizzle schema code for direct inspection.'
            }
          },
          required: ['schemaPath']
        }
      },
      {
        name: 'lint_drizzle_migration',
        description: 'Enforces defensive database engineering rules on SQL migration scripts. Catches destructive actions (DROP TABLE, DROP COLUMN, adding NOT NULL without DEFAULT, unindexed foreign keys, locking table rewrites) before agents commit or apply migrations.',
        inputSchema: {
          type: 'object',
          properties: {
            sqlContent: {
              type: 'string',
              description: 'Raw SQL migration script text to lint.'
            },
            migrationFilePath: {
              type: 'string',
              description: 'Path to a .sql migration file.'
            },
            dialect: {
              type: 'string',
              enum: ['postgresql', 'sqlite', 'mysql'],
              default: 'postgresql',
              description: 'Target database dialect.'
            }
          }
        }
      },
      {
        name: 'detect_schema_drift',
        description: 'Compares declared TypeScript Drizzle schema against live database table state to pinpoint schema drift, missing columns/tables, and outputs safe zero-downtime remediation SQL.',
        inputSchema: {
          type: 'object',
          properties: {
            schemaPath: {
              type: 'string',
              description: 'Path to the declared Drizzle TypeScript schema file.'
            },
            databaseTables: {
              type: 'array',
              description: 'Array of live database tables and columns for comparison.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  columns: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        type: { type: 'string' },
                        isNullable: { type: 'boolean' }
                      },
                      required: ['name', 'type']
                    }
                  }
                },
                required: ['name', 'columns']
              }
            }
          },
          required: ['schemaPath', 'databaseTables']
        }
      },
      {
        name: 'explain_query_plan',
        description: 'Validates SQL queries against a strict read-only sandbox, detects missing LIMIT or unindexed sorting smells, and constructs an EXPLAIN execution plan query for performance verification.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'The SELECT SQL query to analyze.'
            },
            dialect: {
              type: 'string',
              enum: ['postgresql', 'sqlite', 'mysql'],
              default: 'postgresql',
              description: 'Target database dialect.'
            },
            maxRows: {
              type: 'number',
              default: 50,
              description: 'Max row limit safety constraint.'
            }
          },
          required: ['sql']
        }
      }
    ]
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
          text: `Tool execution error: ${error.message}`
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
