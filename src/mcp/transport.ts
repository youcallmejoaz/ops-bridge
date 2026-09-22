import type {
  Request as ExpressRequest,
  RequestHandler,
  Response as ExpressResponse,
} from 'express';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import { logger } from '../utils/logging.js';

/**
 * Bridges an Express route to the SDK's web-standard `McpHttpHandler`
 * (`fetch(request: Request): Promise<Response>` — see
 * @modelcontextprotocol/server's `createMcpHandler`). We hand-roll this
 * instead of pulling in `@modelcontextprotocol/node`'s adapter because
 * that package's `toNodeHandler` is built for its Hono-based server
 * runtime (it depends on `@hono/node-server`) — an unnecessary dependency
 * for a plain Express app. Node 18+ ships the Fetch API's `Request` /
 * `Response` / `Headers` globally, which is all this needs.
 *
 * `express.json()` (applied by `createMcpExpressApp`) has already
 * consumed the request stream into `req.body` by the time this runs, so
 * we re-serialize it rather than trying to re-read the original stream.
 */
export function toExpressHandler(handler: McpHttpHandler): RequestHandler {
  return (req: ExpressRequest, res: ExpressResponse) => {
    void handleRequest(handler, req, res);
  };
}

async function handleRequest(
  handler: McpHttpHandler,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> {
  try {
    const url = new URL(req.originalUrl, `${req.protocol}://${req.get('host') ?? 'localhost'}`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.append(key, value);
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined;
    const bodyText =
      hasBody && Object.keys(req.body as Record<string, unknown>).length > 0
        ? JSON.stringify(req.body)
        : undefined;

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    });

    const webResponse = await handler.fetch(
      webRequest,
      req.auth ? { authInfo: req.auth } : undefined,
    );

    res.status(webResponse.status);
    webResponse.headers.forEach((value, key) => {
      // Node sets its own transfer-encoding/connection framing; passing
      // these through from the fetch Response can conflict with it.
      if (key === 'content-encoding' || key === 'connection') return;
      res.setHeader(key, value);
    });

    if (!webResponse.body) {
      res.end();
      return;
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = webResponse.body.getReader();
    for (;;) {
      const result: { done: boolean; value: Uint8Array | undefined } = await reader.read();
      if (result.done || result.value === undefined) break;
      res.write(result.value);
    }
    res.end();
  } catch (err) {
    logger.error(
      { event: 'transport_error', error: err instanceof Error ? err.message : String(err) },
      'MCP transport error',
    );
    if (!res.headersSent) {
      res.status(500).json({
        error: 'internal_error',
        message: 'An unexpected error occurred handling the MCP request.',
      });
    } else {
      res.end();
    }
  }
}
