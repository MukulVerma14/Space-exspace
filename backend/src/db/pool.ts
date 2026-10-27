import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

/**
 * PostgreSQL Connection Pool.
 * WHY: Reusing a pool of connections avoids the high latency of establishing
 * a new TCP connection and SSL/TLS handshake on every incoming HTTP request.
 */
export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  max: 20, // Max concurrent connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle PostgreSQL client');
});

/**
 * Database health check function.
 * Returns true if a connection can be established and 'SELECT 1' succeeds.
 */
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true, latencyMs: Date.now() - start };
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
