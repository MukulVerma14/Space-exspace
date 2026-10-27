import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Login rate limiter.
 * WHY: Brute-force protection on authentication endpoints is essential.
 * Repeated incorrect attempts from an IP address are throttled to prevent
 * credential guessing attacks.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: env.NODE_ENV === 'test' ? 100 : 10, // 10 attempts per 15 min in dev/prod; 100 in tests
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many login attempts from this IP, please try again after 15 minutes',
  },
});
