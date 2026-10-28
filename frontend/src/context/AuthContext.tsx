/**
 * AuthContext — global authentication state.
 *
 * WHY A CONTEXT:
 * Any component in the tree (nav bar, route guards, pages) needs to know
 * the current user and role.  Passing props down would be prop-drilling hell.
 * React Context is the idiomatic solution for "cross-cutting" state.
 *
 * /me CHECK ON LOAD:
 * On mount, if a token exists in localStorage we call GET /api/auth/me.
 * This validates the token is still accepted by the server (not expired,
 * user still active) and hydrates the user object without asking them to
 * log in again.  If /me returns 401, the stored token is cleared and the
 * user is sent to the login page.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  ApiRequestError,
  clearToken,
  loadToken,
  loginRequest,
  meRequest,
  saveToken,
} from '../api/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'staff';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

type AuthStatus = 'booting' | 'unauthenticated' | 'authenticated';

interface AuthContextValue {
  /** The resolved authentication state */
  status: AuthStatus;
  /** Null until status === 'authenticated' */
  user: AuthUser | null;
  /** Call with email + password. Throws ApiRequestError on failure. */
  login: (email: string, password: string) => Promise<void>;
  /** Clears token + user, returns to unauthenticated */
  logout: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<AuthUser | null>(null);

  // On mount: if a token is stored, verify it with /me
  useEffect(() => {
    const token = loadToken();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }

    meRequest()
      .then((res) => {
        setUser(res.user);
        setStatus('authenticated');
      })
      .catch((err: unknown) => {
        // 401 = expired or revoked — clear and go to login
        if (err instanceof ApiRequestError && err.status === 401) {
          clearToken();
        }
        // Any other network error (backend down, etc.) — still clear session
        // so the user can log in fresh when the server is back.
        clearToken();
        setStatus('unauthenticated');
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password);
    saveToken(res.token);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
