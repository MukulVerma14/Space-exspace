import { Router } from 'express';
import { login, getMe } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rateLimiter.js';

export const authRouter = Router();

// Public login route with brute-force rate limiting
authRouter.post('/login', loginRateLimiter, login);

// Authenticated session profile route
authRouter.get('/me', authenticate, getMe);
