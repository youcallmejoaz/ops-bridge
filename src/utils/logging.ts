import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Paths pino should redact wherever they appear in logged objects. Covers
 * request headers, common provider SDK error shapes, and our own env dump.
 * Never log API keys, tokens, or authorization headers (see spec §17).
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["authorization"]',
  '*.headers.authorization',
  'headers.authorization',
  'authorization',
  '*.apiKey',
  'apiKey',
  '*.api_key',
  'api_key',
  '*.secret',
  'secret',
  '*.token',
  'token',
  '*.password',
  'password',
  'MCP_AUTH_SECRET',
  'GHL_API_KEY',
  'BREVO_API_KEY',
  'STRIPE_SECRET_KEY',
];

const prettyTransport =
  env.NODE_ENV === 'development'
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      }
    : undefined;

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'opsbridge-mcp' },
  ...(prettyTransport ? { transport: prettyTransport } : {}),
});

export interface ToolLogContext {
  requestId: string;
  toolName: string;
  integration?: string;
}

/**
 * Structured wrapper for tool execution: logs start/end with duration and
 * outcome, per spec §17. Use around every MCP tool handler and every
 * outbound integration call.
 */
export async function withToolLogging<T>(ctx: ToolLogContext, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  logger.info({ ...ctx, event: 'tool_start' }, `Starting ${ctx.toolName}`);
  try {
    const result = await fn();
    logger.info(
      { ...ctx, event: 'tool_success', durationMs: Math.round(performance.now() - start) },
      `Completed ${ctx.toolName}`,
    );
    return result;
  } catch (err) {
    const category =
      err && typeof err === 'object' && 'category' in err ? err.category : 'internal';
    logger.error(
      {
        ...ctx,
        event: 'tool_error',
        durationMs: Math.round(performance.now() - start),
        errorCategory: category,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      `Failed ${ctx.toolName}`,
    );
    throw err;
  }
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}
