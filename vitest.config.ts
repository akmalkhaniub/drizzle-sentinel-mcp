import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@drizzle-sentinel/rules-engine': path.resolve(__dirname, './packages/rules-engine/src/index.ts'),
      '@drizzle-sentinel/mcp-server': path.resolve(__dirname, './packages/mcp-server/src/index.ts')
    }
  },
  test: {
    globals: true,
    environment: 'node'
  }
});
