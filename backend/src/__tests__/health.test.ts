import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import * as dbModule from '../db/pool.js';

describe('GET /health', () => {
  it('returns 200 with status "ok" and database connected when DB is reachable', async () => {
    vi.spyOn(dbModule, 'checkDbHealth').mockResolvedValueOnce({
      ok: true,
      latencyMs: 3,
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      database: {
        status: 'connected',
        latencyMs: 3,
      },
    });
    expect(response.body.timestamp).toBeDefined();
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('returns 503 with status "degraded" when database is unreachable', async () => {
    vi.spyOn(dbModule, 'checkDbHealth').mockResolvedValueOnce({
      ok: false,
      error: 'Connection refused',
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'degraded',
      database: {
        status: 'disconnected',
        error: 'Connection refused',
      },
    });
  });

  it('returns 404 for unknown endpoints', async () => {
    const response = await request(app).get('/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('error', 'Route not found');
  });
});
