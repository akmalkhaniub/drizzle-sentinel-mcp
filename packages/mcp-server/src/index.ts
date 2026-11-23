#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDrizzleSentinelServer } from './server-factory.js';

const server = createDrizzleSentinelServer();

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
