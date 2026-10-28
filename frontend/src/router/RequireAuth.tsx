/**
 * RequireAuth — route guard.
 *
 * While auth is 'booting' (verifying the stored token via /me), show a
 * full-screen spinner so the user never sees a flash to the login page.
 *
 * Once boot is resolved:
 *   - unauthenticated → redirect to /login (preserving intended destination)
 *   - authenticated, wrong role → redirect to their role's home
 *   - authenticated, correct role → render children
 *
 * WHY NOT ROLE-HIDE IN THE UI:
 * This guard only handles *navigation* — it redirects the browser to the
 * right page.  What data the user actually *sees* is entirely determined by
 * what the server sends back (sanitizeFinancials on the backend).  We never
 * use role checks to show/hide data that arrived in the response.
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

  // Wrong role → send to their home
  if (role && user.role !== role) {
    const home = user.role === 'admin' ? '/admin' : '/staff';
    return <Navigate to={home} replace />;
  }

  return <Outlet />;
}
