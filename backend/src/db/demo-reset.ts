/**
 * Demo reset: drops the public schema, re-runs migrations, then loads the seed data.
 *
 * Guards (all must pass, otherwise the script exits without touching the database):
 *   - ALLOW_DEMO_SEED=true
 *   - NODE_ENV is not "production"
 *   - DATABASE_URL is set
 *
 * Run (from the repo root):   npm --workspace=backend run demo:reset
 * Nightly cron: see docs/DEPLOY.md section 8.
 */
import { execSync } from 'node:child_process';
import pg from 'pg';

function refuse(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  refuse('set ALLOW_DEMO_SEED=true to reset the demo database.');
}
if (process.env.NODE_ENV === 'production') {
  refuse('demo reset is disabled when NODE_ENV=production.');
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  refuse('DATABASE_URL is required.');
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  console.log('Dropping and recreating schema public...');
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
} finally {
  await client.end();
}

console.log('Running migrations...');
execSync('npm run migrate:up', { stdio: 'inherit', env: process.env });

console.log('Loading seed data...');
execSync('npm run seed', { stdio: 'inherit', env: process.env });

console.log('Demo database reset complete.');
