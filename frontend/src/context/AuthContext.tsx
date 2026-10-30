/**
 * AuthContext: global authentication state.
 *
 * Offline:  the session survives. The profile comes from IndexedDB.
 * 401:      the session is cleared and offline data is wiped.
 * Logout:   token, profile and all snapshots are wiped (shared phones).
 * Other user signs in: previous user's offline data is wiped first.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  ApiRequestError,
  clearToken,
  loadToken,
  loginRequest,
  meRequest,
  saveToken,
} from '../api/client';
import { clearAllOfflineData, loadProfile, saveProfile } from '../offline/db';

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
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

/** Wipe offline data without blocking logout if the wipe fails. */
async function wipeOfflineData(): Promise<void> {
  try {
    await clearAllOfflineData();
  } catch (err) {
    console.error('[auth] offline wipe failed', err);
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const token = loadToken();
      if (!token) {
        setStatus('unauthenticated');
        return;
      }

      try {
        const res = await meRequest();
        await saveProfile(res.user);
        if (cancelled) return;
        setUser(res.user);
        setStatus('authenticated');
      } catch (err: unknown) {
        if (cancelled) return;

        // Server rejected the token: clear everything.
        if (err instanceof ApiRequestError && err.status === 401) {
          clearToken();
          await wipeOfflineData();
          setStatus('unauthenticated');
          return;
        }

        // Offline or 5xx: keep the session and boot from the saved profile.
        const cached = await loadProfile<AuthUser>();
        if (cancelled) return;
        if (cached) {
          setUser(cached);
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password);
    saveToken(res.token);

    // Different person on the same phone: don't let them see the last user's data.
    const previous = await loadProfile<AuthUser>();
    if (previous && previous.id !== res.user.id) {
      await wipeOfflineData();
    }

    await saveProfile(res.user);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    clearToken();
    await wipeOfflineData();
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
