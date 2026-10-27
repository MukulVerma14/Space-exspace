import { Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { JwtTokenPayload } from '../types/auth.js';

/**
 * Zod validation schema for login credentials.
 * WHY: Validating input at the controller boundary prevents malformed payloads
 * from reaching business logic or database queries.
 */
const loginSchema = z.object({
  email: z.string().trim().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * User login controller.
 * Authenticates user credentials and issues an 8-hour JWT token.
 */
export async function login(req: Request, res: Response) {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.flatten().fieldErrors,
    });
  }

  const { email, password } = parseResult.data;

  // Retrieve user account by normalized email
  const result = await pool.query(
    `SELECT id, name, email, password_hash, role, active FROM users WHERE email = $1`,
    [email.toLowerCase()]
  );

  // WHY identical error message: Returning "email not found" vs "incorrect password"
  // leaks user registration status (user enumeration vulnerability).
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];

  if (!user.active) {
    return res.status(401).json({ error: 'User account has been deactivated' });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Generate stateless JWT token
  // WHY 8h expiry: Accommodates a standard equipment yard shift without re-login fatigue,
  // while limiting exposure if a token is intercepted on mobile Wi-Fi.
  const payload: JwtTokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '8h' });

  return res.status(200).json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
}

/**
 * Current user profile controller.
 * Returns the currently authenticated user's session profile.
 */
export async function getMe(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  return res.status(200).json({
    user: req.user,
  });
}
