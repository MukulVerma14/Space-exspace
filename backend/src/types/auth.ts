export type UserRole = 'admin' | 'staff';

export interface AuthenticatedUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface JwtTokenPayload {
  sub: number;
  email: string;
  role: UserRole;
  name: string;
  iat?: number;
  exp?: number;
}

// Extend Express Request interface to include the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
