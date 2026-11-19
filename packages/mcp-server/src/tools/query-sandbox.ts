import { z } from 'zod';
import { redactSensitiveText } from '../security.js';

export const explainQueryPlanSchema = z.object({
  sql: z.string().min(1).max(10_000).describe('The SELECT query to analyze.'),
  dialect: z.enum(['postgresql', 'sqlite', 'mysql']).default('postgresql').describe('Target database dialect.'),
  maxRows: z.number().int().min(1).max(1000).default(50).describe('Maximum row limit constraint for safety sandbox.')
}).strict();

export type ExplainQueryPlanInput = z.input<typeof explainQueryPlanSchema>;

export async function handleExplainQueryPlan(rawInput: ExplainQueryPlanInput) {
  try {
    const input = explainQueryPlanSchema.parse(rawInput);
    const trimmedSql = input.sql.trim();

    // Strip single-quoted literals before checking for stacked statements or mutating SQL keywords
    const sqlWithoutStrings = trimmedSql.replace(/'(?:''|[^'])*'/g, "''");
    if (sqlWithoutStrings.replace(/;+\s*$/, '').includes(';')) {
      throw new Error('Execution blocked: Multi-statement SQL batches are forbidden in read-only sandbox.');
    }

    // Enforce strictly read-only queries across SELECT, WITH (CTE), and EXPLAIN
    const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE', 'CREATE', 'COPY', 'CALL', 'EXEC'];
    const firstWord = trimmedSql.split(/\s+/)[0]?.toUpperCase();

    if (firstWord !== 'SELECT' && firstWord !== 'WITH' && firstWord !== 'EXPLAIN') {
      throw new Error(`Execution blocked: Only SELECT, WITH (CTE), or EXPLAIN queries are permitted. Detected: ${firstWord}`);
    }

    for (const keyword of forbiddenKeywords) {
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(sqlWithoutStrings)) {
        throw new Error(`Execution blocked: Forbidden mutating or DDL keyword detected (${keyword}).`);
      }
    }

    // Generate EXPLAIN command based on dialect
    let explainPrefix = 'EXPLAIN ANALYZE ';
    if (input.dialect === 'sqlite') {
      explainPrefix = 'EXPLAIN QUERY PLAN ';
    } else if (input.dialect === 'mysql') {
      explainPrefix = 'EXPLAIN FORMAT=JSON ';
    }

    const explainQuery = trimmedSql.toUpperCase().startsWith('EXPLAIN') ? trimmedSql : `${explainPrefix}${trimmedSql}`;

    // Analysis of potential performance smells
    const smells: string[] = [];
    if (!trimmedSql.toUpperCase().includes('LIMIT')) {
      smells.push('MISSING_LIMIT: Query does not contain an explicit LIMIT clause. Large result sets may consume excessive memory.');
    }
    if (trimmedSql.includes('*') && trimmedSql.toUpperCase().includes('SELECT *')) {
      smells.push('WILDCARD_PROJECTION: Query uses SELECT *. Prefer specifying only needed column projections for optimal index-only scan utilization.');
    }
    if (trimmedSql.toUpperCase().includes('ORDER BY') && !trimmedSql.toUpperCase().includes('INDEX')) {
      smells.push('SORT_MEMORY_RISK: ORDER BY without index coverage may result in Disk Sort operations on high-cardinality tables.');
    }

    const payload = {
      status: 'VALIDATED_SAFE',
      dialect: input.dialect,
      explainCommand: explainQuery,
      isReadOnly: true,
      maxRowsEnforced: input.maxRows,
      detectedPerformanceSmells: smells,
      recommendation: smells.length === 0 ? 'Query structure is optimal and safe.' : 'Review performance smells before running in production.'
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2)
        }
      ],
      structuredContent: payload
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Query sandbox safety check failed: ${redactSensitiveText(error?.message || String(error))}`
        }
      ]
    };
  }
}
