import { createMcpExpressApp } from '@modelcontextprotocol/express';
import type { Express, RequestHandler } from 'express';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { createSharedSecretVerifier } from './auth/authentication.js';
import { mcpHandler, SERVER_VERSION } from './mcp/server.js';
import { toExpressHandler } from './mcp/transport.js';

/**
 * Checks the static MCP_AUTH_SECRET bearer token and rejects otherwise.
 *
 * Deliberately NOT the SDK's `requireBearerAuth` — that helper is built for
 * a real OAuth resource server and answers a failed check with a
 * `WWW-Authenticate: Bearer ...` challenge (RFC 6750 §3). This server has no
 * authorization server, no token endpoint, and no `/.well-known/oauth-*`
 * metadata behind it — MCP_AUTH_SECRET is a long-lived shared secret, not an
 * issued OAuth token. Some MCP clients treat that challenge header as "this
 * server speaks OAuth" and attempt discovery/Dynamic Client Registration
 * before ever trying a configured static header, which only 404s here and
 * breaks the connection. A plain 401 with no WWW-Authenticate header gives
 * such clients nothing to discover, so they fall back to the static header
 * the user configured.
 */
function staticBearerAuth(verifier: OAuthTokenVerifier): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token.' });
      return;
    }
    verifier
      .verifyAccessToken(token)
      .then((authInfo) => {
        req.auth = authInfo;
        next();
      })
      .catch(() => {
        res.status(401).json({ error: 'unauthorized', message: 'Invalid bearer token.' });
      });
  };
}

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

  const auth = staticBearerAuth(createSharedSecretVerifier());
  app.all('/mcp', auth, toExpressHandler(mcpHandler));

  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: 'not_found', message: 'No such route. The MCP endpoint is at /mcp.' });
  });

  return app;
}
