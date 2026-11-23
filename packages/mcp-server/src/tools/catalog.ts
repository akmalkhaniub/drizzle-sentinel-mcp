export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

export const REGISTERED_TOOLS = [
  {
    name: 'inspect_drizzle_schema',
    description: 'Deeply parses TypeScript Drizzle ORM schema files. Extracts table definitions, columns, data types, nullability, defaults, primary/foreign keys, and alerts on missing indexes.',
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        schemaPath: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: 'Workspace-contained path to the Drizzle schema TypeScript file.'
        },
        inlineContent: {
          type: 'string',
          maxLength: 100000,
          description: 'Optional inline TypeScript Drizzle schema code for direct inspection.'
        }
      },
      required: ['schemaPath'],
      additionalProperties: false
    }
  },
  {
    name: 'lint_drizzle_migration',
    description: 'Enforces defensive database engineering rules on SQL migration scripts. Catches destructive actions (DROP TABLE, DROP COLUMN, adding NOT NULL without DEFAULT, unindexed foreign keys, locking table rewrites) before agents commit or apply migrations.',
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        sqlContent: {
          type: 'string',
          maxLength: 100000,
          description: 'Raw SQL migration script text to lint.'
        },
        migrationFilePath: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: 'Workspace-contained path to a .sql migration file.'
        },
        dialect: {
          type: 'string',
          enum: ['postgresql', 'sqlite', 'mysql'],
          default: 'postgresql',
          description: 'Target database dialect.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'detect_schema_drift',
    description: 'Compares declared TypeScript Drizzle schema against live database table state to pinpoint schema drift, missing columns/tables, and outputs safe zero-downtime remediation SQL.',
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        schemaPath: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: 'Workspace-contained path to the declared Drizzle TypeScript schema file.'
        },
        databaseTables: {
          type: 'array',
          maxItems: 200,
          description: 'Array of live database tables and columns for comparison.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 128 },
              columns: {
                type: 'array',
                maxItems: 200,
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', minLength: 1, maxLength: 128 },
                    type: { type: 'string', minLength: 1, maxLength: 128 },
                    isNullable: { type: 'boolean' }
                  },
                  required: ['name', 'type'],
                  additionalProperties: false
                }
              }
            },
            required: ['name', 'columns'],
            additionalProperties: false
          }
        }
      },
      required: ['schemaPath', 'databaseTables'],
      additionalProperties: false
    }
  },
  {
    name: 'explain_query_plan',
    description: 'Validates SQL queries against a strict read-only sandbox, detects missing LIMIT or unindexed sorting smells, and constructs an EXPLAIN execution plan query for performance verification.',
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          minLength: 1,
          maxLength: 10000,
          description: 'The SELECT SQL query to analyze.'
        },
        dialect: {
          type: 'string',
          enum: ['postgresql', 'sqlite', 'mysql'],
          default: 'postgresql',
          description: 'Target database dialect.'
        },
        maxRows: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          default: 50,
          description: 'Max row limit safety constraint.'
        }
      },
      required: ['sql'],
      additionalProperties: false
    }
  },
  {
    name: 'generate_migration_patch',
    description: 'Synthesizes non-destructive expand-only SQL and Drizzle TypeScript migration patches from live schema drift, self-verifies via MigrationRulesEngine, and returns a resource_link artifact.',
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: 'object',
      properties: {
        schemaPath: {
          type: 'string',
          minLength: 1,
          maxLength: 512,
          description: 'Workspace-contained path to the declared Drizzle TypeScript schema file.'
        },
        inlineContent: {
          type: 'string',
          maxLength: 100000,
          description: 'Optional inline Drizzle schema TypeScript source.'
        },
        databaseTables: {
          type: 'array',
          maxItems: 200,
          description: 'Snapshot of live database tables and columns.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 128 },
              columns: {
                type: 'array',
                maxItems: 200,
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', minLength: 1, maxLength: 128 },
                    type: { type: 'string', minLength: 1, maxLength: 128 },
                    isNullable: { type: 'boolean' }
                  },
                  required: ['name', 'type'],
                  additionalProperties: false
                }
              }
            },
            required: ['name', 'columns'],
            additionalProperties: false
          }
        },
        dialect: {
          type: 'string',
          enum: ['postgresql', 'sqlite', 'mysql'],
          default: 'postgresql',
          description: 'Target SQL dialect.'
        },
        migrationName: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          pattern: '^[a-zA-Z0-9_-]+$',
          default: '0001_non_destructive_sync',
          description: 'Identifier for the generated migration patch.'
        },
        notNullStrategy: {
          type: 'string',
          enum: ['safe-default', 'nullable-expand'],
          default: 'safe-default',
          description: 'Strategy for NOT NULL columns added without explicit defaults.'
        }
      },
      required: ['schemaPath', 'databaseTables'],
      additionalProperties: false
    }
  }
];
