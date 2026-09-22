import { createApp } from './app.js';
import { assertIntegrationConfig, env } from './config/env.js';
import { mcpHandler } from './mcp/server.js';
import { logger } from './utils/logging.js';

assertIntegrationConfig();

const app = createApp();

const httpServer = app.listen(env.PORT, () => {
  logger.info(
    { event: 'server_start', port: env.PORT, nodeEnv: env.NODE_ENV },
    `OpsBridge MCP listening on port ${env.PORT}`,
  );
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ event: 'server_shutdown', signal }, `Received ${signal}, shutting down gracefully`);

  const httpClosed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await Promise.all([httpClosed, mcpHandler.close()]);

  logger.info({ event: 'server_shutdown_complete' }, 'Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
