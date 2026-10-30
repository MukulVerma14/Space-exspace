/**
 * API Client — centralised HTTP layer with JWT token handling.
 *
 * WHY A DEDICATED CLIENT:
 * Every fetch in the app would otherwise have to manually read the token
 * from storage, set the Authorization header, parse JSON, and handle 401s.
 * A single client function encapsulates all of that so the rest of the
 * codebase just calls `api.get('/api/equipment')`.
 *
 * TOKEN STORAGE: localStorage is used for simplicity in this prototype.
 * An httpOnly cookie would be more XSS-safe in production, but requires
 * server-side cookie setting support (see docs/OPEN_QUESTIONS.md).
 */

import { calibrateClockFromServerTime } from '../offline/clock';

const TOKEN_KEY = 'sx_token';

// ─── Token helpers ────────────────────────────────────────────────────────────

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function loadToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}


// ─── Core fetch wrapper ───────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiError {
  status: number;
  message: string;
  body: unknown;
}

export class ApiRequestError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  skipAuth = false
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!skipAuth) {
    const token = loadToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Try to parse JSON regardless of status so we can include the server's
  // error message in the thrown error.
  let data: unknown;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  // Calibrate client clock offset from server Date header or response body server_time
  const serverTimeHeader = res.headers.get('date');
  if (serverTimeHeader) {
    calibrateClockFromServerTime(serverTimeHeader);
  } else if (typeof data === 'object' && data !== null && 'server_time' in data) {
    calibrateClockFromServerTime(String((data as Record<string, unknown>).server_time));
  }

  if (!res.ok) {
    // Extract the server-provided message if present
    const serverMessage =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${res.status}`;

    throw new ApiRequestError(res.status, serverMessage, data);
  }

  return data as T;
}

// ─── Convenience methods ──────────────────────────────────────────────────────

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, skipAuth = false) =>
    request<T>('POST', path, body, skipAuth),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ─── Auth-specific calls ──────────────────────────────────────────────────────

export interface LoginResponse {
  message: string;
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'staff';
  };
}

export interface MeResponse {
  user: {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'staff';
  };
}

export async function loginRequest(
  email: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>('POST', '/api/auth/login', { email, password }, true);
}

export async function meRequest(): Promise<MeResponse> {
  return request<MeResponse>('GET', '/api/auth/me');
}
