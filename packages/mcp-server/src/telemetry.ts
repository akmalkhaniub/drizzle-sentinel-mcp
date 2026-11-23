import * as crypto from 'crypto';

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
  spanId: string;
  traceFlags: string;
  tracestate?: string;
  traceparent: string;
  source: 'http-header' | 'jsonrpc-meta' | 'generated';
}

const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export function extractHeaderValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

/**
 * Dual-channel W3C Trace Context extractor (HTTP headers + JSON-RPC params._meta)
 * per OTel-over-MCP conventions. Mints a fresh child span ID for local execution.
 */
export function resolveTraceContext(options: {
  headers?: Record<string, string | string[] | undefined>;
  meta?: Record<string, unknown>;
}): TraceContext {
  const headerTp = extractHeaderValue(options.headers, 'traceparent')?.trim();
  const metaTp = typeof options.meta?.traceparent === 'string' ? options.meta.traceparent.trim() : undefined;

  const headerTs = extractHeaderValue(options.headers, 'tracestate')?.trim();
  const metaTs = typeof options.meta?.tracestate === 'string' ? options.meta.tracestate.trim() : undefined;

  const rawTp = headerTp || metaTp;
  const source: TraceContext['source'] = headerTp ? 'http-header' : metaTp ? 'jsonrpc-meta' : 'generated';
  const spanId = randomHex(8);

  if (rawTp) {
    const match = TRACEPARENT_RE.exec(rawTp);
    if (match && match[1] !== '00000000000000000000000000000000' && match[2] !== '0000000000000000') {
      const traceId = match[1].toLowerCase();
      const parentSpanId = match[2].toLowerCase();
      const traceFlags = match[3].toLowerCase();
      return {
        traceId,
        parentSpanId,
        spanId,
        traceFlags,
        tracestate: headerTs || metaTs,
        traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
        source
      };
    }
  }

  const traceId = randomHex(16);
  const traceFlags = '01';
  return {
    traceId,
    spanId,
    traceFlags,
    tracestate: headerTs || metaTs,
    traceparent: `00-${traceId}-${spanId}-${traceFlags}`,
    source: 'generated'
  };
}
