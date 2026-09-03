import { createAppContext, createLogger, resolveAppPaths } from '@school-library/core';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

/** Entry point for the local service. */
async function main(): Promise<void> {
  const config = loadConfig();

  // Paths are resolved first so the logger can write to the data directory's
  // logs folder from the very first line — including any startup failure.
  const paths = resolveAppPaths(config.dataRoot);
  const logger = createLogger({ logDirectory: paths.logs, level: config.logLevel });

  const context = createAppContext({ dataRoot: paths.root, logger });

  if (!config.isLoopback) {
    logger.warn(
      { host: config.host },
      'Service is bound to a non-loopback address. Local-network access requires authentication (PRODUCT_SPEC.md §20).',
    );
  }

  const app = buildApp(context);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await app.close();
    context.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
  logger.info({ url: `http://${config.host}:${config.port}` }, 'Local service listening');
}

main().catch((error: unknown) => {
  // Logging may not be initialised yet, so report to stderr and stop.
  console.error('Failed to start the local service:', error);
  process.exitCode = 1;
});
