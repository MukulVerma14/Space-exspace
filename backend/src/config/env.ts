import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file into process.env
dotenv.config();

/**
 * Environment configuration schema.
 * WHY: Validating environment variables at startup ensures fail-fast behavior:
 * the application immediately crashes with a descriptive message rather than
 * failing silently later during a client request when an expected secret or DB host is missing.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().positive().default(3000),

  // PostgreSQL Connection Config
  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: z.coerce.number().positive().default(5432),
  DB_USER: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().min(1).default('postgres'),
  DB_NAME: z.string().min(1).default('space_exspace'),

  // JWT Configuration
  // Enforcing min 32 chars prevents accidental use of weak, bruteforce-susceptible secrets
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for security'),
  JWT_EXPIRES_IN: z.string().default('8h'),

  // CORS Configuration
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', JSON.stringify(parsedEnv.error.format(), null, 2));
  process.exit(1);
}

export const env = parsedEnv.data;
export type Env = z.infer<typeof envSchema>;
