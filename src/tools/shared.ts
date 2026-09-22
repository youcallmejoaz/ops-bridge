import type {
  AuthInfo,
  CallToolResult,
  ToolAnnotations,
  ToolCallback,
} from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { requireScopes, type ScopeName } from '../auth/authentication.js';
import { toOpsBridgeError, type OpsBridgeError } from '../errors/errors.js';
import { generateRequestId, withToolLogging } from '../utils/logging.js';

/**
 * Shared scaffolding every MCP tool is built on. Centralizes the
 * cross-cutting concerns (spec §14 authorization, §17 logging, §12 error
 * shaping) so individual tool files only declare *what* they do — name,
 * description, schema, scopes, and business logic — not *how* those
 * concerns are wired.
 */

export interface ToolResultPayload {
  /** Human-readable summary shown as the tool's text content. */
  summary: string;
  /** Structured data returned alongside the summary. */
  data: unknown;
}

export interface ToolSpec<Shape extends z.ZodRawShape> {
  name: string;
  title?: string;
  description: string;
  inputSchema: z.ZodObject<Shape>;
  annotations?: ToolAnnotations;
  /** Scopes required to call this tool — enforced before `execute` runs. */
  requiredScopes: ScopeName[];
  /** Integration this tool belongs to, for log attribution. */
  integration?: string;
  execute: (
    args: z.infer<z.ZodObject<Shape>>,
    context: { authInfo: AuthInfo | undefined },
  ) => Promise<ToolResultPayload>;
}

export interface RegisteredToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  config: {
    title?: string;
    description: string;
    inputSchema: z.ZodObject<Shape>;
    annotations?: ToolAnnotations;
  };
  handler: ToolCallback<z.ZodObject<Shape>>;
}

/**
 * Wraps a ToolSpec into the {name, config, handler} shape
 * `McpServer.registerTool` expects, adding scope enforcement, structured
 * logging, and uniform error-to-CallToolResult mapping around the
 * business logic in `execute`.
 */
export function defineTool<Shape extends z.ZodRawShape>(
  spec: ToolSpec<Shape>,
): RegisteredToolDefinition<Shape> {
  const handler: ToolCallback<z.ZodObject<Shape>> = async (args, ctx) => {
    const requestId = generateRequestId();
    const authInfo = ctx.http?.authInfo;
    try {
      const result = await withToolLogging(
        {
          requestId,
          toolName: spec.name,
          ...(spec.integration ? { integration: spec.integration } : {}),
        },
        async () => {
          requireScopes(authInfo, spec.requiredScopes);
          return spec.execute(args, { authInfo });
        },
      );
      return {
        content: [{ type: 'text', text: result.summary }],
        structuredContent: result.data,
      } satisfies CallToolResult;
    } catch (err) {
      const opsError = toOpsBridgeError(err, spec.integration);
      return {
        content: [{ type: 'text', text: formatErrorForClient(opsError) }],
        isError: true,
      } satisfies CallToolResult;
    }
  };

  return {
    name: spec.name,
    config: {
      description: spec.description,
      inputSchema: spec.inputSchema,
      ...(spec.title !== undefined ? { title: spec.title } : {}),
      ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
    },
    handler,
  };
}

function formatErrorForClient(err: OpsBridgeError): string {
  const prefix = err.integration ? `[${err.integration}] ` : '';
  return `${prefix}${err.message}`;
}
