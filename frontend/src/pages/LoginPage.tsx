/**
 * Login Page
 *
 * Design goals:
 * - Mobile-first, full-screen centered card
 * - Shows a loading spinner on the submit button while the request is in-flight
 * - Surfaces the server's exact error message (wrong password, account inactive…)
 * - On success, navigates to the `from` location saved by RequireAuth,
 *   or to the role-appropriate home (/admin or /staff)
 * - Never auto-redirects somewhere unexpected if already logged in
 *   (handled by the redirect in App router)
 */

import { useState, useId } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiRequestError } from '../api/client';

// ─── Inline SVG icons to avoid an icon library dep ───────────────────────────

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconEye({ show }: { show: boolean }) {
  return show ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If somehow already authenticated, redirect away
  if (user) {
    const home = user.role === 'admin' ? '/admin' : '/staff';
    navigate(home, { replace: true });
    return null;
  }

  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email.trim(), password);
      // After login, user is now set in context — navigate to intended page or role home
      // We must read role from the login response; context may not re-render yet,
      // so we navigate to a catch-all that the router will redirect correctly.
      navigate(from ?? '/', { replace: true });
    } catch (err: unknown) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Network error — is the server running?');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="full-center">
      <div
        className="card animate-fade-up"
        style={{
          width: '100%',
          maxWidth: '420px',
          padding: 'var(--space-8)',
        }}
      >
        {/* Brand header */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <div
            style={{
              width: 56,
              height: 56,
              background: 'linear-gradient(135deg, var(--color-primary), #7c3aed)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 800,
              color: '#fff',
              margin: '0 auto var(--space-4)',
              letterSpacing: '-1px',
              boxShadow: 'var(--shadow-glow)',
            }}
          >
            SX
          </div>
          <h1
            style={{
              fontSize: 'var(--text-xl)',
              fontWeight: 700,
              color: 'var(--color-text)',
              marginBottom: 'var(--space-1)',
            }}
          >
            SPACE EXSPACE
          </h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            Equipment &amp; Materials Tracker
          </p>
        </div>

        {/* Error alert */}
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 'var(--space-5)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Login form */}
        <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Email */}
          <div className="form-field">
            <label className="form-label" htmlFor={emailId}>
              Email address
            </label>
            <div className="input-group">
              <span className="input-icon"><IconMail /></span>
              <input
                id={emailId}
                type="email"
                className="input"
                placeholder="you@spaceexspace.com"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {/* Password */}
          <div className="form-field">
            <label className="form-label" htmlFor={passwordId}>
              Password
            </label>
            <div className="input-group">
              <span className="input-icon"><IconLock /></span>
              <input
                id={passwordId}
                type={showPassword ? 'text' : 'password'}
                className="input"
                style={{ paddingRight: '3rem' }}
                placeholder="••••••••••••"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 'var(--space-3)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  padding: 'var(--space-1)',
                  display: 'flex',
                }}
              >
                <IconEye show={showPassword} />
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            id="login-submit-btn"
            type="submit"
            className="btn btn-primary btn-lg btn-full"
            disabled={loading || !email || !password}
            style={{ marginTop: 'var(--space-2)' }}
          >
            {loading ? (
              <>
                <div className="spinner" style={{ borderTopColor: 'rgba(255,255,255,0.8)' }} />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        {/* Demo hint — dev builds only, so demo passwords never ship to production */}
        {import.meta.env.DEV && (
        <div
          style={{
            marginTop: 'var(--space-6)',
            padding: 'var(--space-4)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Demo Credentials
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <DemoRow
              label="Admin"
              email="admin@spaceexspace.com"
              onFill={() => { setEmail('admin@spaceexspace.com'); setPassword('Admin#2026!Dev'); }}
            />
            <DemoRow
              label="Staff"
              email="staff@spaceexspace.com"
              onFill={() => { setEmail('staff@spaceexspace.com'); setPassword('Staff#2026!Dev'); }}
            />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function DemoRow({ label, email, onFill }: { label: string; email: string; onFill: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
        {email}
      </span>
      <button
        type="button"
        onClick={onFill}
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-primary)',
          background: 'none',
          border: 'none',
          padding: '2px 6px',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Use {label}
      </button>
    </div>
  );
}
