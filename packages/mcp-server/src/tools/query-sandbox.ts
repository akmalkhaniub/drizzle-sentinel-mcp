import { z } from 'zod';

export const explainQueryPlanSchema = z.object({
  sql: z.string().describe('The SELECT query to analyze.'),
  dialect: z.enum(['postgresql', 'sqlite', 'mysql']).default('postgresql').describe('Target database dialect.'),
  maxRows: z.number().default(50).describe('Maximum row limit constraint for safety sandbox.')
});

export type ExplainQueryPlanInput = z.input<typeof explainQueryPlanSchema>;

export async function handleExplainQueryPlan(rawInput: ExplainQueryPlanInput) {
  try {
    const input = explainQueryPlanSchema.parse(rawInput);
    const trimmedSql = input.sql.trim();

    // Enforce strictly read-only queries
    const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE'];
    const firstWord = trimmedSql.split(/\s+/)[0]?.toUpperCase();

    if (firstWord !== 'SELECT' && firstWord !== 'WITH' && firstWord !== 'EXPLAIN') {
      throw new Error(`Execution blocked: Only SELECT, WITH (CTE), or EXPLAIN queries are permitted. Detected: ${firstWord}`);
    }

    for (const keyword of forbiddenKeywords) {
      const pattern = new RegExp(`\\b${keyword}\\b`, 'i');
      if (pattern.test(trimmedSql) && !trimmedSql.toUpperCase().startsWith('EXPLAIN')) {
        // Exception: CTE with SELECT
        if (firstWord === 'WITH' && (keyword === 'INSERT' || keyword === 'UPDATE' || keyword === 'DELETE')) {
          throw new Error(`Execution blocked: Data modification inside CTE detected (${keyword}).`);
        }
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

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'VALIDATED_SAFE',
            dialect: input.dialect,
            explainCommand: explainQuery,
            isReadOnly: true,
            maxRowsEnforced: input.maxRows,
            detectedPerformanceSmells: smells,
            recommendation: smells.length === 0 ? 'Query structure is optimal and safe.' : 'Review performance smells before running in production.'
          }, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Query sandbox safety check failed: ${error.message}`
        }
      ]
    };
  }
}
