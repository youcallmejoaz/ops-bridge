import { createMcpExpressApp, requireBearerAuth } from '@modelcontextprotocol/express';
import type { Express } from 'express';
import { createSharedSecretVerifier } from './auth/authentication.js';
import { mcpHandler, SERVER_VERSION } from './mcp/server.js';
import { toExpressHandler } from './mcp/transport.js';

/**
 * Builds the Express app (routes + auth wiring) without starting a
 * listener or installing signal handlers, so it can be exercised directly
 * in tests (see tests/mcp/*.test.ts) via supertest — no real network port
 * needed.
 */
export function createApp(): Express {
  const app = createMcpExpressApp({
    // Cloud platforms (Render/Railway/Fly/etc.) require binding to all
    // interfaces; DNS-rebinding host validation only auto-applies for
    // localhost-class binds, so on 0.0.0.0 this server relies on the
    // MCP_AUTH_SECRET bearer token as its access control instead. Operators
    // fronting this with a known public hostname can harden further by
    // wrapping createMcpExpressApp with `allowedHosts`/`allowedOrigins`.
    host: '0.0.0.0',
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'opsbridge-mcp', version: SERVER_VERSION });
  });

  const auth = requireBearerAuth({ verifier: createSharedSecretVerifier() });
  app.all('/mcp', auth, toExpressHandler(mcpHandler));

  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: 'not_found', message: 'No such route. The MCP endpoint is at /mcp.' });
  });

  return app;
}
