import { createApp } from './app.js';
import { assertIntegrationConfig } from './config/env.js';

/**
 * Serverless entry point for Vercel — `api/index.js` (a plain JS re-export
 * shim, deliberately outside this TypeScript project) imports the compiled
 * output of this file. The container/Render path boots via server.ts
 * instead, which calls app.listen() and installs SIGTERM/SIGINT handlers
 * for graceful shutdown; neither applies to a request-scoped serverless
 * function, so this entry point skips both.
 *
 * mcp/server.ts builds a fresh McpServer per HTTP request and holds no
 * state between requests, so this app has no session-affinity requirement
 * and maps cleanly onto serverless — every invocation is independent, and
 * createApp() is safe to call once here and reused across invocations of a
 * warm function instance.
 */
assertIntegrationConfig();

export default createApp();
