import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { JwtTokenPayload, UserRole } from '../types/auth.js';

/**
 * Authentication Middleware.
 * WHY: Verifies stateless JWT tokens from the Authorization header and
 * confirms in PostgreSQL that the user account has not been deactivated.
 * This combines the low overhead of JWTs with immediate revocation capability.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required: missing or malformed token' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as unknown as JwtTokenPayload;

    // Check that user is active in PostgreSQL
    // WHY: If a staff member leaves the company and an admin sets active = false,
    // this check revokes their access immediately rather than waiting 8 hours for the JWT to expire.
    const userRes = await pool.query(
      `SELECT id, name, email, role, active FROM users WHERE id = $1`,
      [decoded.sub]
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].active) {
      return res.status(401).json({ error: 'User account is inactive or no longer exists' });
    }

    const dbUser = userRes.rows[0];
    req.user = {
      id: dbUser.id,
      name: dbUser.name,
      email: dbUser.email,
      role: dbUser.role as UserRole,
    };

    next();
  } catch (err: unknown) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: 'Authentication token has expired' });
    }
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
}

/**
 * Role-Based Access Control (RBAC) Guard Middleware.
 * WHY: Restricts administrative operations (such as managing rate cards, customer contracts,
 * or financial records) to users possessing the required authorization level.
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Access forbidden: insufficient permissions',
        requiredRoles: allowedRoles,
        currentRole: req.user.role,
      });
    }

    next();
  };
}
