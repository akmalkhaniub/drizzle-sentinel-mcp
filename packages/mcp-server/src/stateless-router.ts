import * as crypto from 'crypto';
import { REGISTERED_TOOLS } from './tools/catalog.js';
import {
  REGISTERED_PROMPTS,
  RESOURCE_TEMPLATES,
  completeArgument,
  getAuditMigrationPrompt,
  listWorkspaceResources,
  readDrizzleResource
} from './tools/resources.js';
import { TOOLS_LIST_CACHE_TTL_MS, dispatchToolCall } from './server-factory.js';
import { extractHeaderValue, resolveTraceContext } from './telemetry.js';

export interface StatelessMcpHttpRequest {
  method: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface StatelessMcpHttpResponse {
  status: number;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

const TOOLS_ETAG = `"${crypto
  .createHash('sha256')
  .update(JSON.stringify(REGISTERED_TOOLS))
  .digest('hex')
  .slice(0, 16)}"`;

/**
 * Stateless MCP (2026-07-28) HTTP dispatcher supporting:
 * - Edge header routing via `Mcp-Method` and `Mcp-Name`
 * - Cacheable `tools/list` (`ttlMs` + `Cache-Control` + `ETag` / 304)
 * - Dual-channel W3C `traceparent` propagation
 * - Zero `Mcp-Session-Id` / zero sticky session affinity
 */
export async function handleStatelessMcpRequest(req: StatelessMcpHttpRequest): Promise<StatelessMcpHttpResponse> {
  if (req.method.toUpperCase() !== 'POST') {
    return {
      status: 405,
      headers: { Allow: 'POST', 'Content-Type': 'application/json' },
      body: { error: 'Method Not Allowed. Use POST for stateless JSON-RPC MCP requests.' }
    };
  }

  const payload = typeof req.body === 'string'
    ? safeJsonParse(req.body)
    : req.body;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request: JSON-RPC payload must be a JSON object.' }
      }
    };
  }

  const rpc = payload as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
  };

  const id = rpc.id ?? null;
  const headerMethod = extractHeaderValue(req.headers, 'mcp-method')?.trim();
  const headerToolName = extractHeaderValue(req.headers, 'mcp-name')?.trim();
  const rpcMethod = rpc.method?.trim();

  if (headerMethod && rpcMethod && headerMethod !== rpcMethod) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: `Header routing mismatch: Mcp-Method='${headerMethod}' does not match JSON-RPC method='${rpcMethod}'.`
        }
      }
    };
  }

  const effectiveMethod = rpcMethod || headerMethod;
  if (!effectiveMethod) {
    return {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Missing MCP method in JSON-RPC body and Mcp-Method header.' }
      }
    };
  }

  const params = (rpc.params && typeof rpc.params === 'object' ? rpc.params : {}) as Record<string, any>;
  const trace = resolveTraceContext({ headers: req.headers, meta: params._meta });
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2026-07-28',
    'X-Trace-Id': trace.traceId,
    traceparent: trace.traceparent
  };

  if (effectiveMethod === 'tools/list') {
    const ifNoneMatch = extractHeaderValue(req.headers, 'if-none-match')?.trim();
    const cacheHeaders = {
      ...baseHeaders,
      ETag: TOOLS_ETAG,
      'Cache-Control': `public, max-age=${Math.floor(TOOLS_LIST_CACHE_TTL_MS / 1000)}`
    };
    if (ifNoneMatch && ifNoneMatch === TOOLS_ETAG) {
      return { status: 304, headers: cacheHeaders };
    }
    return {
      status: 200,
      headers: cacheHeaders,
      body: {
        jsonrpc: '2.0',
        id,
        result: {
          tools: REGISTERED_TOOLS,
          _meta: {
            ttlMs: TOOLS_LIST_CACHE_TTL_MS,
            specVersion: '2026-07-28',
            otel: { trace_id: trace.traceId, span_id: trace.spanId }
          }
        }
      }
    };
  }

  if (effectiveMethod === 'tools/call') {
    const bodyName = typeof params.name === 'string' ? params.name : undefined;
    if (headerToolName && bodyName && headerToolName !== bodyName) {
      return {
        status: 400,
        headers: baseHeaders,
        body: {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: `Header routing mismatch: Mcp-Name='${headerToolName}' does not match params.name='${bodyName}'.`
          }
        }
      };
    }

    const toolName = bodyName || headerToolName;
    if (!toolName) {
      return {
        status: 400,
        headers: baseHeaders,
        body: {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name in params.name and Mcp-Name header.' }
        }
      };
    }

    try {
      const result = await dispatchToolCall(toolName, params.arguments ?? {}, params._meta, req.headers);
      return {
        status: 200,
        headers: baseHeaders,
        body: { jsonrpc: '2.0', id, result }
      };
    } catch (error: any) {
      return {
        status: 404,
        headers: baseHeaders,
        body: {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: error?.message || `Unknown tool: ${toolName}` }
        }
      };
    }
  }

  if (effectiveMethod === 'resources/list') {
    return {
      status: 200,
      headers: baseHeaders,
      body: { jsonrpc: '2.0', id, result: { resources: listWorkspaceResources() } }
    };
  }

  if (effectiveMethod === 'resources/templates/list') {
    return {
      status: 200,
      headers: baseHeaders,
      body: { jsonrpc: '2.0', id, result: { resourceTemplates: RESOURCE_TEMPLATES } }
    };
  }

  if (effectiveMethod === 'resources/read') {
    try {
      const content = readDrizzleResource(String(params.uri || ''));
      return {
        status: 200,
        headers: baseHeaders,
        body: { jsonrpc: '2.0', id, result: { contents: [content] } }
      };
    } catch (error: any) {
      return {
        status: 404,
        headers: baseHeaders,
        body: { jsonrpc: '2.0', id, error: { code: -32002, message: error?.message || 'Resource not found' } }
      };
    }
  }

  if (effectiveMethod === 'prompts/list') {
    return {
      status: 200,
      headers: baseHeaders,
      body: { jsonrpc: '2.0', id, result: { prompts: REGISTERED_PROMPTS } }
    };
  }

  if (effectiveMethod === 'prompts/get') {
    if (params.name !== 'audit_migration') {
      return {
        status: 404,
        headers: baseHeaders,
        body: { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown prompt: ${params.name}` } }
      };
    }
    return {
      status: 200,
      headers: baseHeaders,
      body: { jsonrpc: '2.0', id, result: getAuditMigrationPrompt(params.arguments) }
    };
  }

  if (effectiveMethod === 'completion/complete') {
    return {
      status: 200,
      headers: baseHeaders,
      body: { jsonrpc: '2.0', id, result: { completion: completeArgument(params as any) } }
    };
  }

  return {
    status: 404,
    headers: baseHeaders,
    body: {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${effectiveMethod}` }
    }
  };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
