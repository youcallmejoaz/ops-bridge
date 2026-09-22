/**
 * Standardized error hierarchy for OpsBridge MCP.
 *
 * Every error that can reach an MCP tool response extends OpsBridgeError.
 * Messages are written to be useful to the calling AI/user without ever
 * exposing secrets (API keys, tokens, authorization headers). Integration
 * clients are responsible for mapping provider-specific errors into these
 * types at the boundary — see integrations/<provider>/client.ts.
 */

export type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'not_found'
  | 'rate_limit'
  | 'external_api'
  | 'configuration'
  | 'internal';

export interface OpsBridgeErrorOptions {
  /** The integration this error originated from, if any (e.g. "ghl", "brevo", "stripe"). */
  integration?: string;
  /** Additional structured context, safe to log and return (no secrets). */
  context?: Record<string, unknown>;
  cause?: unknown;
}

export abstract class OpsBridgeError extends Error {
  abstract readonly category: ErrorCategory;
  readonly integration: string | undefined;
  readonly context: Record<string, unknown> | undefined;

  constructor(message: string, options: OpsBridgeErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.integration = options.integration;
    this.context = options.context;
  }

  /** Shape returned to the MCP client — never includes stack traces or raw provider payloads. */
  toResponse(): { category: ErrorCategory; message: string; integration?: string } {
    return {
      category: this.category,
      message: this.message,
      ...(this.integration ? { integration: this.integration } : {}),
    };
  }
}

export class AuthenticationError extends OpsBridgeError {
  readonly category = 'authentication' as const;
}

export class AuthorizationError extends OpsBridgeError {
  readonly category = 'authorization' as const;
}

export class ValidationError extends OpsBridgeError {
  readonly category = 'validation' as const;
}

export class NotFoundError extends OpsBridgeError {
  readonly category = 'not_found' as const;
}

export class RateLimitError extends OpsBridgeError {
  readonly category = 'rate_limit' as const;
  readonly retryAfterMs: number | undefined;

  constructor(message: string, options: OpsBridgeErrorOptions & { retryAfterMs?: number } = {}) {
    super(message, options);
    this.retryAfterMs = options.retryAfterMs;
  }
}

export class ExternalAPIError extends OpsBridgeError {
  readonly category = 'external_api' as const;
  readonly statusCode: number | undefined;

  constructor(message: string, options: OpsBridgeErrorOptions & { statusCode?: number } = {}) {
    super(message, options);
    this.statusCode = options.statusCode;
  }
}

export class ConfigurationError extends OpsBridgeError {
  readonly category = 'configuration' as const;
}

/**
 * Redacts common secret-shaped fields from an arbitrary object before it is
 * logged or returned. Used as a last line of defense in addition to the
 * pino `redact` paths in utils/logging.ts.
 */
const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|bearer)/i;

export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redact(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else if (typeof val === 'object' && val !== null) {
      out[key] = redact(val);
    } else {
      out[key] = val;
    }
  }
  return out as T;
}

/** Wraps an unknown thrown value as an OpsBridgeError, defaulting to external_api. */
export function toOpsBridgeError(err: unknown, integration?: string): OpsBridgeError {
  if (err instanceof OpsBridgeError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ExternalAPIError(
    `Unexpected error${integration ? ` from ${integration}` : ''}: ${message}`,
    {
      ...(integration !== undefined ? { integration } : {}),
      cause: err,
    },
  );
}
