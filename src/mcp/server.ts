import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { registerTools } from './registration.js';
import { logger } from '../utils/logging.js';

const SERVER_NAME = 'opsbridge-mcp';
export const SERVER_VERSION = '1.0.0';

/**
 * The MCP handler for this server (spec §31: v2 SDK is stateless by
 * default — `createMcpHandler` builds a fresh `McpServer` from this
 * factory per HTTP request and holds nothing between requests, so this
 * process scales horizontally with no session affinity needed). Tool
 * registration itself is cheap (it just wires closures — see
 * tools/shared.ts), so paying that cost per request is not a concern.
 */
export const mcpHandler = createMcpHandler(
  () => {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerTools(server);
    return server;
  },
  {
    onerror: (error) => {
      logger.error({ event: 'mcp_handler_error', error: error.message }, 'MCP handler error');
    },
  },
);
