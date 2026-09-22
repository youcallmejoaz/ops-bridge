import { describe, expect, it } from 'vitest';
import { OAuthError, OAuthErrorCode, type AuthInfo } from '@modelcontextprotocol/server';
import { Scope, createSharedSecretVerifier, requireScopes } from '../../src/auth/authentication.js';

describe('createSharedSecretVerifier', () => {
  it('accepts the configured secret and grants scopes', async () => {
    const verifier = createSharedSecretVerifier();
    const info = await verifier.verifyAccessToken(process.env.MCP_AUTH_SECRET as string);
    expect(info.token).toBe(process.env.MCP_AUTH_SECRET);
    expect(info.scopes).toEqual(expect.arrayContaining(Object.values(Scope)));
    expect(info.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a wrong token with OAuthErrorCode.InvalidToken', async () => {
    const verifier = createSharedSecretVerifier();
    await expect(verifier.verifyAccessToken('totally-wrong-token')).rejects.toMatchObject({
      code: OAuthErrorCode.InvalidToken,
    });
  });

  it('rejects with an OAuthError instance specifically', async () => {
    const verifier = createSharedSecretVerifier();
    try {
      await verifier.verifyAccessToken('nope');
      expect.unreachable('expected verifyAccessToken to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
    }
  });
});

describe('requireScopes', () => {
  const grant = (scopes: string[]): AuthInfo => ({
    token: 't',
    clientId: 'c',
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  it('passes when every required scope is granted', () => {
    expect(() =>
      requireScopes(grant([Scope.READ_CUSTOMERS, Scope.WRITE_CRM]), [Scope.READ_CUSTOMERS]),
    ).not.toThrow();
  });

  it('throws AuthorizationError naming the missing scope(s)', () => {
    expect(() => requireScopes(grant([Scope.READ_CUSTOMERS]), [Scope.WRITE_MARKETING])).toThrow(
      /WRITE_MARKETING/,
    );
  });

  it('throws when authInfo is undefined (no valid token reached the handler)', () => {
    expect(() => requireScopes(undefined, [Scope.READ_CUSTOMERS])).toThrow();
  });

  it('passes trivially when no scopes are required', () => {
    expect(() => requireScopes(undefined, [])).not.toThrow();
  });
});
