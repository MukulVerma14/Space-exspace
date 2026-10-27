import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { pool } from './db/pool.js';

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 SPACE EXSPACE Tracker API running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

/**
 * Graceful shutdown.
 * WHY: When Docker or systemd sends SIGTERM/SIGINT, draining active HTTP connections
 * and closing the DB pool prevents abrupt disconnections and transaction corruption.
 */
async function shutdown(signal: string) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    try {
      await pool.end();
      logger.info('PostgreSQL pool drained.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error closing PostgreSQL pool');
      process.exit(1);
    }
  });

  // Force close if graceful cleanup takes longer than 10 seconds
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcefully terminating.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
