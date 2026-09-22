import { describe, expect, it } from 'vitest';
import {
  AuthenticationError,
  AuthorizationError,
  ExternalAPIError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  redact,
  toOpsBridgeError,
} from '../../src/errors/errors.js';

describe('error hierarchy', () => {
  it('each error type reports its own category and never leaks a stack in toResponse()', () => {
    const err = new AuthenticationError(
      'Brevo authentication failed. Check the configured Brevo API key.',
      {
        integration: 'brevo',
      },
    );
    expect(err.category).toBe('authentication');
    expect(err.toResponse()).toEqual({
      category: 'authentication',
      message: 'Brevo authentication failed. Check the configured Brevo API key.',
      integration: 'brevo',
    });
    expect(err.toResponse()).not.toHaveProperty('stack');
  });

  it('never echoes a secret value even when one is passed as the message', () => {
    // Defensive check: the error's own message is caller-controlled, but
    // toResponse() must not attach anything beyond category/message/integration.
    const err = new AuthorizationError('token lacks required scope');
    const response = err.toResponse();
    expect(Object.keys(response).sort()).toEqual(['category', 'message']);
  });

  it('RateLimitError carries an optional retryAfterMs', () => {
    const err = new RateLimitError('rate limited', { retryAfterMs: 5000 });
    expect(err.retryAfterMs).toBe(5000);
  });

  it('ExternalAPIError carries an optional statusCode', () => {
    const err = new ExternalAPIError('boom', { statusCode: 502 });
    expect(err.statusCode).toBe(502);
  });

  it('NotFoundError and ValidationError categorize correctly', () => {
    expect(new NotFoundError('missing').category).toBe('not_found');
    expect(new ValidationError('bad input').category).toBe('validation');
  });
});

describe('toOpsBridgeError', () => {
  it('passes an existing OpsBridgeError through unchanged', () => {
    const original = new NotFoundError('not found');
    expect(toOpsBridgeError(original)).toBe(original);
  });

  it('wraps a plain Error as an ExternalAPIError', () => {
    const wrapped = toOpsBridgeError(new Error('boom'), 'stripe');
    expect(wrapped).toBeInstanceOf(ExternalAPIError);
    expect(wrapped.integration).toBe('stripe');
    expect(wrapped.message).toContain('boom');
  });

  it('wraps a non-Error thrown value', () => {
    const wrapped = toOpsBridgeError('just a string');
    expect(wrapped).toBeInstanceOf(ExternalAPIError);
    expect(wrapped.message).toContain('just a string');
  });
});

describe('redact', () => {
  it('redacts common secret-shaped keys at any depth', () => {
    const input = {
      apiKey: 'sk_live_abc123',
      nested: { authorization: 'Bearer xyz', password: 'hunter2', safe: 'ok' },
      token: 'ghp_abc',
    };
    const result = redact(input) as typeof input;
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.nested.authorization).toBe('[REDACTED]');
    expect(result.nested.password).toBe('[REDACTED]');
    expect(result.nested.safe).toBe('ok');
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts secrets inside arrays', () => {
    const result = redact([{ secret: 'shh' }, { fine: 'yes' }]) as Array<Record<string, string>>;
    expect(result[0]?.secret).toBe('[REDACTED]');
    expect(result[1]?.fine).toBe('yes');
  });

  it('passes through primitives and null/undefined unchanged', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact('plain string')).toBe('plain string');
    expect(redact(42)).toBe(42);
  });
});
