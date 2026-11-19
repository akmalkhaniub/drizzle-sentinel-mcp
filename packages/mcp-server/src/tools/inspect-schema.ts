import { z } from 'zod';
import { DrizzleSchemaParser } from '../services/drizzle-parser.js';
import { redactSensitiveText, resolveSafeWorkspacePath } from '../security.js';

export const inspectSchemaSchema = z.object({
  schemaPath: z.string().min(1).max(512).describe('Absolute or relative path to the Drizzle schema TypeScript file (e.g., src/db/schema.ts).'),
  inlineContent: z.string().max(100_000).optional().describe('Optional inline TypeScript Drizzle schema code for direct evaluation.')
}).strict();

export type InspectSchemaInput = z.infer<typeof inspectSchemaSchema>;

export async function handleInspectSchema(rawInput: InspectSchemaInput) {
  try {
    const input = inspectSchemaSchema.parse(rawInput);
    let result;
    if (input.inlineContent) {
      result = DrizzleSchemaParser.parseContent(input.inlineContent, input.schemaPath || 'inline-schema.ts');
    } else {
      const safePath = resolveSafeWorkspacePath(input.schemaPath, { allowedExtensions: ['.ts', '.mts', '.cts'] });
      result = DrizzleSchemaParser.parseFile(safePath);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2)
        }
      ],
      structuredContent: result
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Schema inspection failed: ${redactSensitiveText(error?.message || String(error))}`
        }
      ]
    };
  }
}
