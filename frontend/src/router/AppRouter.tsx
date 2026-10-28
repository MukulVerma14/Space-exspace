/**
 * Application Router
 *
 * Route structure:
 *
 *   /login               → LoginPage (public)
 *   /                    → redirect to /admin or /staff based on role
 *   /admin/*             → RequireAuth(role=admin) → AppLayout → admin pages
 *   /staff/*             → RequireAuth(role=staff) → AppLayout → staff pages
 *   *                    → 404
 *
 * WHY SEPARATE /admin AND /staff PREFIXES:
 * It makes the role boundary crystal clear in the URL — an admin URL shared
 * with a staff user will be caught by RequireAuth and redirect them to their
 * own home, not show a blank or broken page.
 *
 * WHY NOT HIDE SECTIONS IN THE UI BY ROLE:
 * The router redirects navigation, but what data appears on each page is
 * determined entirely by the server response. The UI renders what arrives.
 * We never conditionally render data based on role — only navigation.
 */

import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { RequireAuth } from './RequireAuth';
import AppLayout from '../pages/layouts/AppLayout';
import LoginPage from '../pages/LoginPage';
import AdminHomePage from '../pages/admin/AdminHomePage';
import StaffHomePage from '../pages/staff/StaffHomePage';
import PlaceholderPage from '../pages/PlaceholderPage';
import EquipmentListPage from '../pages/shared/EquipmentListPage';

// ─── Root redirect ────────────────────────────────────────────────────────────

function RootRedirect() {
  const { status, user } = useAuth();
  if (status === 'booting') {
    return (
      <div className="full-center">
        <div className="spinner spinner-lg" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === 'admin' ? '/admin' : '/staff'} replace />;
}

// ─── Router definition ────────────────────────────────────────────────────────

const router = createBrowserRouter([
  // Public
  { path: '/login', element: <LoginPage /> },

  // Root → role-aware redirect
  { path: '/', element: <RootRedirect /> },

  // ── Admin zone ──────────────────────────────────────────────────────────────
  {
    element: <RequireAuth role="admin" />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/admin',             element: <AdminHomePage /> },
          { path: '/admin/equipment',   element: <EquipmentListPage /> },
          { path: '/admin/rentals',     element: <PlaceholderPage title="Rentals" /> },
          { path: '/admin/materials',   element: <PlaceholderPage title="Materials" /> },
          { path: '/admin/invoices',    element: <PlaceholderPage title="Invoices" /> },
        ],
      },
    ],
  },

  // ── Staff zone ──────────────────────────────────────────────────────────────
  {
    element: <RequireAuth role="staff" />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/staff',             element: <StaffHomePage /> },
          { path: '/staff/equipment',   element: <EquipmentListPage /> },
          { path: '/staff/rentals',     element: <PlaceholderPage title="Rentals" /> },
          { path: '/staff/materials',   element: <PlaceholderPage title="Stock" /> },
        ],
      },
    ],
  },

  // 404
  {
    path: '*',
    element: (
      <div className="full-center">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 'var(--space-4)' }}>404</div>
          <p style={{ color: 'var(--color-text-muted)' }}>Page not found.</p>
        </div>
      </div>
    ),
  },
]);

// ─── Export ───────────────────────────────────────────────────────────────────

export function AppRouter() {
  return <RouterProvider router={router} />;
}
