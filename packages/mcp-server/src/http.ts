#!/usr/bin/env node
import * as http from 'http';
import { handleStatelessMcpRequest } from './stateless-router.js';

const PORT = Number(process.env.PORT || 3100);
const MAX_BODY_BYTES = 1_048_576;

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', transport: 'stateless-mcp-2026-07-28' }));
    return;
  }

  if (req.url !== '/mcp') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  req.on('data', (chunk: Buffer) => {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BODY_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Payload too large' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf-8');
    const result = await handleStatelessMcpRequest({
      method: req.method || 'POST',
      headers: req.headers,
      body: rawBody
    });
    res.writeHead(result.status, result.headers);
    res.end(result.body ? JSON.stringify(result.body) : undefined);
  });
});

server.listen(PORT, () => {
  console.error(`Drizzle Sentinel Stateless MCP HTTP server listening on http://127.0.0.1:${PORT}/mcp`);
});
