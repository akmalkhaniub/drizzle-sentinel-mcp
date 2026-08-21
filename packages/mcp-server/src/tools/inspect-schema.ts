import { z } from 'zod';
import { DrizzleSchemaParser } from '../services/drizzle-parser.js';

export const inspectSchemaSchema = z.object({
  schemaPath: z.string().describe('Absolute or relative path to the Drizzle schema TypeScript file (e.g., src/db/schema.ts).'),
  inlineContent: z.string().optional().describe('Optional inline TypeScript Drizzle schema code for direct evaluation.')
});

export type InspectSchemaInput = z.infer<typeof inspectSchemaSchema>;

export async function handleInspectSchema(input: InspectSchemaInput) {
  try {
    let result;
    if (input.inlineContent) {
      result = DrizzleSchemaParser.parseContent(input.inlineContent, input.schemaPath || 'inline-schema.ts');
    } else {
      result = DrizzleSchemaParser.parseFile(input.schemaPath);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Schema inspection failed: ${error.message}`
        }
      ]
    };
  }
}
