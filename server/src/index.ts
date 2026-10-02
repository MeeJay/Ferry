import { config } from './config.js';
import { logger } from './logger.js';
import { migrate, db } from './db/knex.js';
import { bootstrap } from './db/bootstrap.js';
import { ensureDirs } from './services/storage.js';
import { startCleanupLoop } from './services/cleanup.js';
import { createApp } from './app.js';

async function main() {
  await ensureDirs();
  await migrate();
  await bootstrap();
  const server = createApp().listen(config.port, () => logger.info({ port: config.port, version: config.version }, 'Ferry server ready'));
  // Large uploads/downloads through slow links: never cut a streaming response.
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;
  startCleanupLoop();

  const shutdown = () => {
    logger.info('shutting down');
    server.close(() => db.destroy().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
