/**
 * AppLayout — persistent shell for all authenticated pages.
 *
 * Contains:
 *   - Desktop top navigation bar (brand, links, status/outbox badges, user, logout)
 *   - Mobile bottom navigation bar (ergonomic bottom touch navigation on phones)
 *   - Outlet rendering current route content
 */

import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { OnlineStatusBadge } from '../../components/OnlineStatusBadge';
import { OutboxBadge } from '../../components/OutboxBadge';
import { clearOutboxForUser, listEvents } from '../../offline/outbox';
import { startOnlineSync } from '../../sync/syncManager';

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    if (user) {
      const unsent = await listEvents(user.id);
      if (unsent.length > 0) {
        const ok = window.confirm(
          `${unsent.length} change(s) are not sent yet. Signing out deletes them. Sign out anyway?`,
        );
        if (!ok) return;
        await clearOutboxForUser(user.id);
      }
    }
    await logout(); // wipes token, profile and snapshots
    navigate('/login', { replace: true });
  }

  // Sync triggers: app start (if online), browser 'online' event. No polling.
  useEffect(() => {
    if (!user) return;
    return startOnlineSync(user.id);
  }, [user]);

  if (!user) return null;

  const homeHref = user.role === 'admin' ? '/admin' : '/staff';

  return (
    <div className="page-shell">
      {/* ── Top Nav ── */}
      <header className="top-nav" role="banner">
        {/* Brand */}
        <NavLink to={homeHref} className="top-nav-brand" aria-label="Home">
          <div className="top-nav-logo" aria-hidden="true">SX</div>
          <div>
            <div className="top-nav-title">SPACE EXSPACE</div>
            <div className="top-nav-subtitle" style={{ display: 'none' }}>
              Tracker
            </div>
          </div>
        </NavLink>

        {/* Nav links — shown on wider screens (>= 600px) */}
        <nav
          aria-label="Main navigation"
          style={{
            display: 'flex',
            gap: 'var(--space-1)',
            flex: 1,
            paddingLeft: 'var(--space-4)',
          }}
        >
          <NavItem to={`${homeHref}/scan`} label="Scan QR" />
          <NavItem to={`${homeHref}/equipment`} label="Equipment" />
          {user.role === 'admin' && (
            <>
              <NavItem to="/admin/rentals" label="Rentals" />
              <NavItem to="/admin/materials" label="Materials" />
              <NavItem to="/admin/invoices" label="Invoices" />
            </>
          )}
          {user.role === 'staff' && (
            <>
              <NavItem to="/staff/rentals" label="Rentals" />
              <NavItem to="/staff/materials" label="Stock" />
            </>
          )}
        </nav>

        {/* Online/offline badge */}
        <OnlineStatusBadge />

        {/* Unsent staff actions */}
        <OutboxBadge />

        {/* User area */}
        <div className="top-nav-user">
          {/* Avatar + role — hidden on very small screens */}
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
            title={user.email}
          >
            <div className="user-avatar" aria-hidden="true">
              {getInitials(user.name)}
            </div>
            <span
              className={`role-tag role-tag-${user.role}`}
              aria-label={`Role: ${user.role}`}
              style={{ display: 'none' }}
              id="user-role-tag"
            >
              {user.role}
            </span>
          </div>

          {/* Logout */}
          <button
            id="logout-btn"
            onClick={handleLogout}
            className="btn btn-ghost"
            style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)' }}
            aria-label="Sign out"
            title="Sign out"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span style={{ display: 'none' }}>Sign out</span>
          </button>
        </div>
      </header>

      {/* ── Page Content ── */}
      <main id="main-content" className="page-content">
        <Outlet />
      </main>

      {/* ── Mobile Navigation Bar (screens < 600px) ── */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        <MobileNavItem to={`${homeHref}/scan`} icon="📷" label="Scan" />
        <MobileNavItem to={`${homeHref}/equipment`} icon="🏗️" label="Fleet" />
        {user.role === 'admin' && (
          <>
            <MobileNavItem to="/admin/rentals" icon="📋" label="Rentals" />
            <MobileNavItem to="/admin/materials" icon="📦" label="Materials" />
            <MobileNavItem to="/admin/invoices" icon="🧾" label="Invoices" />
          </>
        )}
        {user.role === 'staff' && (
          <>
            <MobileNavItem to="/staff/rentals" icon="📋" label="Rentals" />
            <MobileNavItem to="/staff/materials" icon="📦" label="Stock" />
          </>
        )}
      </nav>

      {/* Responsive nav visibility */}
      <style>{`
        @media (min-width: 480px) {
          #user-role-tag { display: inline-flex !important; }
          .top-nav-subtitle { display: block !important; }
          #logout-btn span { display: inline !important; }
        }
        @media (min-width: 600px) {
          .top-nav nav a { display: flex !important; }
          .mobile-bottom-nav { display: none !important; }
        }
        @media (max-width: 599px) {
          .mobile-bottom-nav {
            display: flex !important;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            height: 56px;
            background: rgba(15, 17, 23, 0.96);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-top: 1px solid var(--color-border-subtle);
            z-index: 99;
            padding: 0 var(--space-1);
            align-items: center;
            justify-content: space-around;
          }
          .page-content {
            padding-bottom: calc(var(--space-16) + env(safe-area-inset-bottom, 0px)) !important;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Desktop Nav Item ──────────────────────────────────────────────────────────

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        fontSize: 'var(--text-sm)',
        fontWeight: 500,
        color: isActive ? '#C8A96F' : '#FFFFF0',
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        background: isActive ? 'var(--color-primary-glow)' : 'transparent',
        transition: 'all var(--transition-fast)',
        display: 'none',    /* hidden on mobile, shown via media query above */
      })}
      end
    >
      {label}
    </NavLink>
  );
}

// ─── Mobile Nav Item ───────────────────────────────────────────────────────────

function MobileNavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        padding: '4px 2px',
        textDecoration: 'none',
        color: isActive ? '#C8A96F' : '#FFFFF0',
        fontSize: 'var(--text-xs)',
        fontWeight: isActive ? 600 : 400,
        gap: 2,
        transition: 'color var(--transition-fast)',
      })}
      end
    >
      <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
