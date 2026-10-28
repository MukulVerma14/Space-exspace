import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config/env.js';
import { httpLogger } from './utils/logger.js';
import { checkDbHealth } from './db/pool.js';
import { authRouter } from './routes/authRoutes.js';
import { ratesRouter } from './routes/ratesRoutes.js';
import { equipmentRouter } from './routes/equipmentRoutes.js';
import rentalsRouter from './routes/rentalsRoutes.js';
import materialsRouter from './routes/materialsRoutes.js';
import invoicesRouter from './routes/invoicesRoutes.js';

export const app = express();

// Security headers
app.use(helmet());

// Cross-Origin Resource Sharing
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);

// Body parsing
app.use(express.json());

// Request logging
app.use(httpLogger);

/**
 * Health check endpoint.
 * WHY: Monitoring systems, load balancers, and developer smoke tests
 * use /health to verify process health and DB reachability before routing traffic.
 */
app.get('/health', async (_req, res) => {
  const dbHealth = await checkDbHealth();
  const isHealthy = dbHealth.ok;

  const responsePayload = {
    status: isHealthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    database: {
      status: dbHealth.ok ? 'connected' : 'disconnected',
      ...(dbHealth.latencyMs !== undefined && { latencyMs: dbHealth.latencyMs }),
      ...(dbHealth.error && { error: dbHealth.error }),
    },
  };

  // Return 200 if DB is healthy, or 503 Service Unavailable if critical dependency is unreachable
  return res.status(isHealthy ? 200 : 503).json(responsePayload);
});

// Authentication routes
app.use('/api/auth', authRouter);

// Rates & commercial terms routes
app.use('/api/rates', ratesRouter);

// Equipment & QR tracking routes
app.use('/api/equipment', equipmentRouter);

// Rentals management routes
app.use('/api/rentals', rentalsRouter);

// Materials inventory & ledger routes
app.use('/api/materials', materialsRouter);

// Stored invoices & supplier purchasing routes
app.use('/api/invoices', invoicesRouter);

// 404 handler for unknown routes
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});
