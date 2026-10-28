/**
 * StaffHomePage — landing page for staff role.
 * Staff have operational access only: QR scan, equipment moves, material issues.
 */

import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function StaffHomePage() {
  const { user } = useAuth();

  return (
    <div className="animate-fade-up">
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          Welcome, {user?.name.split(' ')[0]}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Yard Operations — QR scanning, asset moves &amp; stock issues
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 'var(--space-4)',
      }}>
        <QuickCard
          id="staff-nav-equipment"
          to="/staff/equipment"
          icon="🏗️"
          title="Equipment"
          desc="Scan QR, move & return assets"
          color="var(--color-primary)"
        />
        <QuickCard
          id="staff-nav-rentals"
          to="/staff/rentals"
          icon="📋"
          title="Rentals"
          desc="Pickup & return dispatches"
          color="var(--color-warning)"
        />
        <QuickCard
          id="staff-nav-materials"
          to="/staff/materials"
          icon="📦"
          title="Stock"
          desc="Issue & receipt materials"
          color="var(--color-success)"
        />
      </div>
    </div>
  );
}

function QuickCard({
  id,
  to,
  icon,
  title,
  desc,
  color,
}: {
  id: string;
  to: string;
  icon: string;
  title: string;
  desc: string;
  color: string;
}) {
  return (
    <NavLink
      id={id}
      to={to}
      style={{
        display: 'block',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        transition: 'all var(--transition-base)',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = color;
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 1px ${color}22, var(--shadow-md)`;
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-subtle)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLElement).style.transform = 'none';
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 'var(--space-3)' }}>{icon}</div>
      <div style={{ fontWeight: 600, marginBottom: 'var(--space-1)', color: 'var(--color-text)' }}>
        {title}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{desc}</div>
    </NavLink>
  );
}
