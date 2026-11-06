/**
 * RequireAuth — route guard.
 *
 * While auth is 'booting' (verifying the stored token via /me), show a
 * full-screen spinner so the user never sees a flash to the login page.
 *
 * Once boot is resolved:
 *   - unauthenticated → redirect to /login (preserving intended destination)
 *   - authenticated, wrong role → display clear 403 Forbidden access denied screen
 *   - authenticated, correct role → render children
 *
 * WHY NOT ROLE-HIDE IN THE UI:
 * This guard only handles *navigation* — it protects route boundaries.
 * What data the user actually *sees* is entirely determined by what the server
 * sends back (sanitizeFinancials on the backend). We never use role checks to
 * show/hide data that arrived in the response.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth, UserRole } from '../context/AuthContext';

interface RequireAuthProps {
  /** If supplied, only users with this role may access the outlet */
  role?: UserRole;
}

export function RequireAuth({ role }: RequireAuthProps) {
  const { status, user } = useAuth();
  const location = useLocation();

  // Still verifying stored token — show full-screen loading
  if (status === 'booting') {
    return (
      <div className="full-center" aria-label="Verifying session…">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div className="spinner spinner-lg" />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Verifying session…
          </span>
        </div>
      </div>
    );
  }

  // Not logged in → go to login, remember where we were
  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Wrong role → render explicit 403 Forbidden access denial notice
  if (role && user.role !== role) {
    const home = user.role === 'admin' ? '/admin' : '/staff';
    return (
      <div
        className="full-center"
        role="alert"
        aria-label="Access Denied"
        style={{ padding: '2rem' }}
      >
        <div
          className="card"
          style={{
            maxWidth: 480,
            width: '100%',
            textAlign: 'center',
            padding: '2.5rem 2rem',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚫</div>
          <h2 style={{ color: 'var(--color-danger, #ef4444)', marginBottom: '0.75rem' }}>
            Access Denied (403 Forbidden)
          </h2>
          <p
            style={{
              color: 'var(--color-text-muted)',
              marginBottom: '1.5rem',
              lineHeight: 1.5,
              fontSize: 'var(--text-sm)',
            }}
          >
            Your account ({user.email}) has role <strong>'{user.role}'</strong>, which lacks
            permission to access {role === 'admin' ? 'administrative resources' : 'this area'}.
            {role === 'admin'
              ? ' Commercial accounting, rates, and invoice ledgers require Administrator privileges.'
              : ''}
          </p>
          <a
            href={home}
            className="btn btn-primary"
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Go to {user.role === 'admin' ? 'Admin Dashboard' : 'Staff Dashboard'}
          </a>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
