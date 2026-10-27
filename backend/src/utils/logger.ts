import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';

/**
 * Structured logger configured with Pino.
 * WHY: Pino is JSON-first and significantly faster than console.log/winston.
 * In development, we use pino-pretty formatting; in production, raw JSON logs
 * integrate directly into standard log collectors (Datadog, CloudWatch, etc.).
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  // Skip logging during automated test runs to keep test output clean
  autoLogging: env.NODE_ENV !== 'test',
});
