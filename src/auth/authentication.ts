import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { env } from '../config/env.js';
import { AuthorizationError } from '../errors/errors.js';

/**
 * Authorization scopes, distinguishing READ from WRITE operations and
 * separating write operations by the system they touch (spec §14). Designed
 * so role-based permissions can be layered on later without changing tool
 * code — tools declare the scopes they need, and `requireScopes` is the
 * only place that decides whether a caller has them.
 */
export const Scope = {
  READ_CUSTOMERS: 'READ_CUSTOMERS',
  WRITE_CUSTOMERS: 'WRITE_CUSTOMERS',
  WRITE_MARKETING: 'WRITE_MARKETING',
  WRITE_CRM: 'WRITE_CRM',
} as const;

export type ScopeName = (typeof Scope)[keyof typeof Scope];

export const ALL_SCOPES: ScopeName[] = Object.values(Scope);

/**
 * Default grant when MCP_AUTH_SCOPES is unset: full access. Operators who
 * want least-privilege tokens set MCP_AUTH_SCOPES explicitly.
 */
function configuredScopes(): ScopeName[] {
  const configured = env.MCP_AUTH_SCOPES;
  if (!configured || configured.length === 0) return ALL_SCOPES;
  const valid = configured.filter((s): s is ScopeName => (ALL_SCOPES as string[]).includes(s));
  return valid.length > 0 ? valid : ALL_SCOPES;
}

/**
 * Verifies the single shared-secret bearer token configured via
 * MCP_AUTH_SECRET. Implements the SDK's `OAuthTokenVerifier` interface so
 * swapping in a real OAuth 2.0 authorization server later — JWT/introspection
 * verification — is a one-file change; nothing else in the auth or tool
 * layers needs to know which verifier is in use.
 *
 * expiresAt is required by the SDK's bearer-auth helpers (a token without it
 * is rejected as invalid); we set a rolling far-future expiry since this is
 * a long-lived static secret, not an issued, expiring token.
 */
export function createSharedSecretVerifier(): OAuthTokenVerifier {
  const secret = env.MCP_AUTH_SECRET;
  const scopes = configuredScopes();

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      if (!secret) {
        throw new OAuthError(
          OAuthErrorCode.ServerError,
          'MCP_AUTH_SECRET is not configured on this server.',
        );
      }
      if (token !== secret) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'The provided bearer token is invalid.');
      }
      return {
        token,
        clientId: 'opsbridge-static-client',
        scopes,
        // Far-future expiry (100 years) — this is a static shared secret,
        // not a short-lived issued token; rotate it by changing the env var.
        expiresAt: Math.floor(Date.now() / 1000) + 100 * 365 * 24 * 60 * 60,
      };
    },
  };
}

/**
 * Asserts that an authenticated caller's scopes include every scope in
 * `required`. Call this inside a tool handler (after `ctx.http?.authInfo`
 * is available) for tools whose access needs depend on their input (e.g. a
 * cross-system tool that only needs WRITE_CRM when it decides to write a
 * note). Tools with a fixed scope requirement should instead rely on the
 * transport-level `requiredScopes` check in mcp/transport.ts.
 */
export function requireScopes(authInfo: AuthInfo | undefined, required: ScopeName[]): void {
  const granted = new Set(authInfo?.scopes ?? []);
  const missing = required.filter((scope) => !granted.has(scope));
  if (missing.length > 0) {
    throw new AuthorizationError(
      `This operation requires scope(s): ${missing.join(', ')}. The authenticated token does not grant them.`,
    );
  }
}
