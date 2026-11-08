import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { RequireAuth } from './RequireAuth';
import AppLayout from '../pages/layouts/AppLayout';
import LoginPage from '../pages/LoginPage';
import AdminHomePage from '../pages/admin/AdminHomePage';
import StaffHomePage from '../pages/staff/StaffHomePage';
import PlaceholderPage from '../pages/PlaceholderPage';
import EquipmentListPage from '../pages/shared/EquipmentListPage';
import EquipmentDetailPage from '../pages/shared/EquipmentDetailPage';
import MaterialsPage from '../pages/shared/MaterialsPage';
import InvoicesPage from '../pages/admin/InvoicesPage';
import ScanPage from '../pages/shared/ScanPage';
import CameraTestPage from '../pages/shared/CameraTestPage';

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
          { path: '/admin',                         element: <AdminHomePage /> },
          { path: '/admin/scan',                    element: <ScanPage /> },
          { path: '/admin/camera-test',             element: <CameraTestPage /> },
          { path: '/admin/equipment',               element: <EquipmentListPage /> },
          { path: '/admin/equipment/:asset_code',   element: <EquipmentDetailPage /> },
          { path: '/admin/rentals',                 element: <PlaceholderPage title="Rentals" /> },
          { path: '/admin/materials',               element: <MaterialsPage /> },
          { path: '/admin/invoices',                element: <InvoicesPage /> },
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
          { path: '/staff',                         element: <StaffHomePage /> },
          { path: '/staff/scan',                    element: <ScanPage /> },
          { path: '/staff/camera-test',             element: <CameraTestPage /> },
          { path: '/staff/equipment',               element: <EquipmentListPage /> },
          { path: '/staff/equipment/:asset_code',   element: <EquipmentDetailPage /> },
          { path: '/staff/rentals',                 element: <PlaceholderPage title="Rentals" /> },
          { path: '/staff/materials',               element: <MaterialsPage /> },
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
