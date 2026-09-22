import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const boolFromString = z
  .string()
  .default('true')
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false']))
  .transform((v) => v === 'true');

const csvScopes = z
  .string()
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  MCP_AUTH_SECRET: z
    .string()
    .min(
      16,
      'MCP_AUTH_SECRET must be at least 16 characters — generate one with `openssl rand -hex 32`',
    )
    .optional(),
  MCP_AUTH_SCOPES: csvScopes,

  ENABLE_GHL: boolFromString,
  ENABLE_BREVO: boolFromString,
  ENABLE_STRIPE: boolFromString,

  GHL_API_KEY: z.string().optional(),
  GHL_LOCATION_ID: z.string().optional(),

  BREVO_API_KEY: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Fields we intentionally omit from any logging/debug surface.
 */
const SENSITIVE_ENV_KEYS = new Set([
  'MCP_AUTH_SECRET',
  'GHL_API_KEY',
  'BREVO_API_KEY',
  'STRIPE_SECRET_KEY',
]);

function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);

/**
 * Cross-field validation: if an integration is enabled, its required
 * credentials must be present. Runs eagerly at startup so misconfiguration
 * fails fast instead of surfacing as a confusing tool-call error later.
 */
export function assertIntegrationConfig(e: Env = env): void {
  const problems: string[] = [];

  if (!e.MCP_AUTH_SECRET) {
    problems.push(
      'MCP_AUTH_SECRET must be set — without it no client can authenticate. Generate one with `openssl rand -hex 32`.',
    );
  }

  if (e.ENABLE_GHL && (!e.GHL_API_KEY || !e.GHL_LOCATION_ID)) {
    problems.push('ENABLE_GHL=true requires GHL_API_KEY and GHL_LOCATION_ID to be set.');
  }
  if (e.ENABLE_BREVO && !e.BREVO_API_KEY) {
    problems.push('ENABLE_BREVO=true requires BREVO_API_KEY to be set.');
  }
  if (e.ENABLE_STRIPE && !e.STRIPE_SECRET_KEY) {
    problems.push('ENABLE_STRIPE=true requires STRIPE_SECRET_KEY to be set.');
  }
  if (!e.ENABLE_GHL && !e.ENABLE_BREVO && !e.ENABLE_STRIPE) {
    problems.push('At least one integration (GHL, Brevo, or Stripe) must be enabled.');
  }

  if (problems.length > 0) {
    throw new Error(`Configuration error:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

export function redactEnvKey(key: string, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return SENSITIVE_ENV_KEYS.has(key) ? '[REDACTED]' : value;
}
