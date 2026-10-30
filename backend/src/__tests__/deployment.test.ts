import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { app } from '../app.js';
import { seedDatabase } from '../db/seed.js';
import { envSchema } from '../config/env.js';
import { pool } from '../db/pool.js';
import * as poolModule from '../db/pool.js';
import bcrypt from 'bcrypt';

describe('Step 6b, 6c & 6d: Production Deployment Readiness & Operational Safeguards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('Proxy Trust & Client IP Resolution (trust proxy: 1)', () => {
    it('configures trust proxy to 1 on the main Express application', () => {
      // Main application must have trust proxy explicitly configured to 1
      const trustProxy = app.get('trust proxy');
      expect(trustProxy).toBe(1);
    });

    it('resolves real client IP from X-Forwarded-For header when trust proxy: 1 is active', async () => {
      const clientIp = '203.0.113.195';

      // Reverse proxy (e.g. Caddy / Nginx) forwards the client IP in X-Forwarded-For
      const testApp = express();
      testApp.set('trust proxy', 1);
      testApp.get('/api/test-ip', (req, res) => {
        res.json({
          ip: req.ip,
          ips: req.ips,
        });
      });

      const res = await request(testApp)
        .get('/api/test-ip')
        .set('X-Forwarded-For', clientIp);

      expect(res.status).toBe(200);
      expect(res.body.ip).toBe(clientIp);
    });
  });

  describe('Health Check DB Connectivity Reporting (GET /health)', () => {
    it('reports database connectivity, uptime, and latency when DB is healthy (HTTP 200)', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptimeSeconds).toBe('number');
      expect(res.body.database.status).toBe('connected');
      expect(typeof res.body.database.latencyMs).toBe('number');
      expect(res.body.database.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns HTTP 503 Service Unavailable when DB connectivity check fails', async () => {
      // Mock checkDbHealth to simulate database connection outage
      const checkDbHealthSpy = vi.spyOn(poolModule, 'checkDbHealth').mockResolvedValueOnce({
        ok: false,
        error: 'connection to database failed: timeout',
      });

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.database.status).toBe('disconnected');
      expect(res.body.database.error).toContain('connection to database failed');

      checkDbHealthSpy.mockRestore();
    });
  });

  describe('Production Database Seed Safeguards (ALLOW_DEMO_SEED)', () => {
    it('strictly refuses seed execution when NODE_ENV=production without ALLOW_DEMO_SEED=true', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_DEMO_SEED;

      await expect(seedDatabase()).rejects.toThrow(
        /Database seeding is strictly disabled in production mode.*ALLOW_DEMO_SEED=true/i
      );
    });

    it('refuses seed execution when NODE_ENV=production and ALLOW_DEMO_SEED=false', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_DEMO_SEED = 'false';

      await expect(seedDatabase()).rejects.toThrow(
        /Database seeding is strictly disabled in production mode.*ALLOW_DEMO_SEED=true/i
      );
    });

    it('permits seed execution when NODE_ENV=production and ALLOW_DEMO_SEED=true with custom passwords', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_DEMO_SEED = 'true';
      const customAdminPass = 'CustomProdAdminPass_987654!';
      const customStaffPass = 'CustomProdStaffPass_987654!';
      process.env.DEMO_ADMIN_PASSWORD = customAdminPass;
      process.env.DEMO_STAFF_PASSWORD = customStaffPass;

      // Seed should succeed without error
      await expect(seedDatabase()).resolves.not.toThrow();

      // Verify that user record in DB was hashed with the custom env password
      const adminRes = await pool.query(`SELECT password_hash FROM users WHERE email = 'admin@spaceexspace.com'`);
      expect(adminRes.rows.length).toBe(1);
      const isMatch = await bcrypt.compare(customAdminPass, adminRes.rows[0].password_hash);
      expect(isMatch).toBe(true);

      // Re-seed with standard dev passwords so subsequent tests can log in with dev credentials
      process.env.DEMO_ADMIN_PASSWORD = 'Admin#2026!Dev';
      process.env.DEMO_STAFF_PASSWORD = 'Staff#2026!Dev';
      await seedDatabase();
    });
  });

  describe('Fail-Fast Environment Validation (envSchema)', () => {
    const validBaseConfig = {
      PORT: '3000',
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_USER: 'postgres',
      DB_PASSWORD: 'postgres_password',
      DB_NAME: 'space_exspace',
      CORS_ORIGIN: 'https://app.spaceexspace.com',
      JWT_SECRET: 'a_very_strong_production_secret_key_exceeding_32_characters_long',
    };

    it('rejects JWT_SECRET shorter than 32 characters when NODE_ENV=production', () => {
      const shortSecretConfig = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        JWT_SECRET: 'short_secret_only_24_chars!', // 27 characters < 32
      };

      const result = envSchema.safeParse(shortSecretConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('JWT_SECRET must be at least 32 characters in production'))).toBe(true);
      }
    });

    it('rejects default dev JWT_SECRET when NODE_ENV=production', () => {
      const prodConfig = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        JWT_SECRET: 'dev_jwt_secret_must_be_changed_in_production_min32chars',
      };

      const result = envSchema.safeParse(prodConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('Default development JWT_SECRET must be changed'))).toBe(true);
      }
    });

    it('requires DEMO_ADMIN_PASSWORD and DEMO_STAFF_PASSWORD in production if ALLOW_DEMO_SEED=true', () => {
      const prodSeedConfig = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        ALLOW_DEMO_SEED: 'true',
      };

      const result = envSchema.safeParse(prodSeedConfig);
      expect(result.success).toBe(false);
      if (!result.success) {
        const issues = result.error.issues;
        expect(issues.some((i) => i.message.includes('DEMO_ADMIN_PASSWORD must be provided'))).toBe(true);
        expect(issues.some((i) => i.message.includes('DEMO_STAFF_PASSWORD must be provided'))).toBe(true);
      }
    });

    it('passes validation in production when strong secrets and required vars are provided', () => {
      const validProdConfig = {
        ...validBaseConfig,
        NODE_ENV: 'production',
        ALLOW_DEMO_SEED: 'true',
        DEMO_ADMIN_PASSWORD: 'SecureAdminPassword123!',
        DEMO_STAFF_PASSWORD: 'SecureStaffPassword123!',
      };

      const result = envSchema.safeParse(validProdConfig);
      expect(result.success).toBe(true);
    });

    it('allows shorter dev secrets when NODE_ENV=development', () => {
      const devConfig = {
        NODE_ENV: 'development',
        JWT_SECRET: 'short_dev_secret',
      };

      const result = envSchema.safeParse(devConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('Security Headers (Helmet) & CORS Integration', () => {
    it('sets standard Helmet security headers on responses', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
    });

    it('sets Access-Control-Allow-Origin header matching CORS configuration', async () => {
      const res = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });
  });

  describe('Step 6d: Caddyfile HSTS Security Header Policy & Validation', () => {
    const caddyfilePath = path.resolve(process.cwd(), '../Caddyfile');

    it('contains the Caddyfile configuration file at repository root', () => {
      expect(fs.existsSync(caddyfilePath)).toBe(true);
    });

    it('configures HSTS with configurable max-age defaulting to 300 seconds for demo', () => {
      const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf8');

      // Assert that Strict-Transport-Security is defined with {$HSTS_MAX_AGE:300}
      expect(caddyfileContent).toMatch(/Strict-Transport-Security\s+"max-age={\$HSTS_MAX_AGE:300}"/);
    });

    it('omits includeSubDomains and preload from the default HSTS header', () => {
      const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf8');
      const hstsDirective = caddyfileContent
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('Strict-Transport-Security'));

      expect(hstsDirective).toBeDefined();
      expect(hstsDirective).not.toContain('includeSubDomains');
      expect(hstsDirective).not.toContain('preload');
    });

    it('renders default 300 seconds when HSTS_MAX_AGE is not provided', () => {
      const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf8');
      const hstsMatch = caddyfileContent.match(/Strict-Transport-Security\s+"([^"]+)"/);
      expect(hstsMatch).not.toBeNull();

      const rawDirective = hstsMatch![1];
      // Simulate Caddy's template substitution: {$HSTS_MAX_AGE:300} -> 300 when unset
      const evaluatedDefault = rawDirective.replace(/\{\$HSTS_MAX_AGE:300\}/g, '300');
      expect(evaluatedDefault).toBe('max-age=300');
      expect(evaluatedDefault).not.toContain('includeSubDomains');
      expect(evaluatedDefault).not.toContain('preload');
    });

    it('renders custom duration (e.g. 1 year for mature production) when HSTS_MAX_AGE is set', () => {
      const caddyfileContent = fs.readFileSync(caddyfilePath, 'utf8');
      const hstsMatch = caddyfileContent.match(/Strict-Transport-Security\s+"([^"]+)"/);
      expect(hstsMatch).not.toBeNull();

      const rawDirective = hstsMatch![1];
      // Simulate Caddy's template substitution with production 1 year (31536000s)
      const evaluatedProd = rawDirective.replace(/\{\$HSTS_MAX_AGE:300\}/g, '31536000');
      expect(evaluatedProd).toBe('max-age=31536000');
    });
  });

  describe('Step 6d: Backup Encryption & Write-Only Invariants in Scripts', () => {
    const backupScriptPath = path.resolve(process.cwd(), '../scripts/backup_daily.sh');
    const restoreScriptPath = path.resolve(process.cwd(), '../scripts/restore.sh');

    it('enforces client-side crypt encryption layer before off-site S3 replication', () => {
      expect(fs.existsSync(backupScriptPath)).toBe(true);
      const backupContent = fs.readFileSync(backupScriptPath, 'utf8');

      // Asserts that rclone crypt remote is configured
      expect(backupContent).toContain('RCLONE_CONFIG_S3_CRYPT_TYPE="crypt"');
      expect(backupContent).toContain('s3_crypt:');
      // Asserts that missing passphrase exits with fatal error code 11
      expect(backupContent).toContain('exit 11');
      // Asserts that secrets are cleared from environment
      expect(backupContent).toContain('unset RCLONE_CONFIG_S3_CRYPT_PASSWORD');
    });

    it('does not contain remote deletion or pruning commands due to write-only IAM permissions', () => {
      const backupContent = fs.readFileSync(backupScriptPath, 'utf8');

      // Write-only IAM accounts cannot list or delete remote objects.
      // Remote pruning must NOT be performed by the backup script.
      expect(backupContent).not.toMatch(/rclone\s+(delete|rm|purge)\s+s3/);
      expect(backupContent).not.toMatch(/rclone\s+deletefile\s+s3/);

      // Local disk rotation must be preserved
      expect(backupContent).toContain('Purging local backups older than');
      expect(backupContent).toContain('find "${BACKUP_DIR}"');
    });

    it('restore script verifies encryption proof before attempting restoration', () => {
      expect(fs.existsSync(restoreScriptPath)).toBe(true);
      const restoreContent = fs.readFileSync(restoreScriptPath, 'utf8');

      // Restore script must test pg_restore rejection against raw encrypted files
      expect(restoreContent).toContain('PGDMP');
      expect(restoreContent).toContain('PROOF VERIFIED: pg_restore rejected raw encrypted file');
      expect(restoreContent).toContain('RCLONE_CONFIG_S3_CRYPT_TYPE="crypt"');
    });
  });
});
