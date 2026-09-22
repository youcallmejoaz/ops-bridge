import { describe, expect, it } from 'vitest';
import { assertIntegrationConfig, redactEnvKey, type Env } from '../../src/config/env.js';

const baseValidEnv: Env = {
  NODE_ENV: 'test',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  MCP_AUTH_SECRET: 'a-sufficiently-long-secret-value',
  MCP_AUTH_SCOPES: undefined,
  ENABLE_GHL: true,
  ENABLE_BREVO: true,
  ENABLE_STRIPE: true,
  GHL_API_KEY: 'ghl-key',
  GHL_LOCATION_ID: 'loc-id',
  BREVO_API_KEY: 'brevo-key',
  STRIPE_SECRET_KEY: 'sk_test_x',
};

describe('assertIntegrationConfig', () => {
  it('passes for a fully configured, fully enabled environment', () => {
    expect(() => assertIntegrationConfig(baseValidEnv)).not.toThrow();
  });

  it('requires MCP_AUTH_SECRET regardless of which integrations are enabled', () => {
    expect(() => assertIntegrationConfig({ ...baseValidEnv, MCP_AUTH_SECRET: undefined })).toThrow(
      /MCP_AUTH_SECRET/,
    );
  });

  it('requires GHL_API_KEY and GHL_LOCATION_ID when ENABLE_GHL is true', () => {
    expect(() => assertIntegrationConfig({ ...baseValidEnv, GHL_API_KEY: undefined })).toThrow(
      /ENABLE_GHL/,
    );
    expect(() => assertIntegrationConfig({ ...baseValidEnv, GHL_LOCATION_ID: undefined })).toThrow(
      /ENABLE_GHL/,
    );
  });

  it('does not require GHL credentials when ENABLE_GHL is false', () => {
    expect(() =>
      assertIntegrationConfig({
        ...baseValidEnv,
        ENABLE_GHL: false,
        GHL_API_KEY: undefined,
        GHL_LOCATION_ID: undefined,
      }),
    ).not.toThrow();
  });

  it('requires BREVO_API_KEY when ENABLE_BREVO is true', () => {
    expect(() => assertIntegrationConfig({ ...baseValidEnv, BREVO_API_KEY: undefined })).toThrow(
      /ENABLE_BREVO/,
    );
  });

  it('requires STRIPE_SECRET_KEY when ENABLE_STRIPE is true', () => {
    expect(() =>
      assertIntegrationConfig({ ...baseValidEnv, STRIPE_SECRET_KEY: undefined }),
    ).toThrow(/ENABLE_STRIPE/);
  });

  it('rejects a configuration with every integration disabled', () => {
    expect(() =>
      assertIntegrationConfig({
        ...baseValidEnv,
        ENABLE_GHL: false,
        ENABLE_BREVO: false,
        ENABLE_STRIPE: false,
        GHL_API_KEY: undefined,
        GHL_LOCATION_ID: undefined,
        BREVO_API_KEY: undefined,
        STRIPE_SECRET_KEY: undefined,
      }),
    ).toThrow(/at least one integration/i);
  });

  it('reports every problem at once, not just the first', () => {
    try {
      assertIntegrationConfig({
        ...baseValidEnv,
        MCP_AUTH_SECRET: undefined,
        BREVO_API_KEY: undefined,
      });
      expect.unreachable('expected assertIntegrationConfig to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('MCP_AUTH_SECRET');
      expect(message).toContain('ENABLE_BREVO');
    }
  });
});

describe('redactEnvKey', () => {
  it('redacts known-sensitive keys', () => {
    expect(redactEnvKey('MCP_AUTH_SECRET', 'super-secret')).toBe('[REDACTED]');
    expect(redactEnvKey('STRIPE_SECRET_KEY', 'sk_live_x')).toBe('[REDACTED]');
  });

  it('leaves non-sensitive keys untouched', () => {
    expect(redactEnvKey('NODE_ENV', 'production')).toBe('production');
  });

  it('passes through undefined', () => {
    expect(redactEnvKey('MCP_AUTH_SECRET', undefined)).toBeUndefined();
  });
});
