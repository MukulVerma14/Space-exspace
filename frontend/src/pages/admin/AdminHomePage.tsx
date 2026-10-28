/**
 * AdminHomePage — landing page for admin role.
 * Placeholder until individual feature pages are built in later steps.
 */

import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function AdminHomePage() {
  const { user } = useAuth();

  return (
    <div className="animate-fade-up">
      {/* Welcome header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          Welcome back, {user?.name.split(' ')[0]}
        </h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Operations Director Dashboard — Full fleet &amp; financial visibility
        </p>
      </div>

      {/* Quick-nav cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 'var(--space-4)',
      }}>
        <QuickCard
          id="nav-equipment"
          to="/admin/equipment"
          icon="🏗️"
          title="Equipment Fleet"
          desc="Search, filter & scan assets"
          color="var(--color-primary)"
        />
        <QuickCard
          id="nav-rentals"
          to="/admin/rentals"
          icon="📋"
          title="Rentals"
          desc="Contracts, pickup & return"
          color="var(--color-warning)"
        />
        <QuickCard
          id="nav-materials"
          to="/admin/materials"
          icon="📦"
          title="Materials"
          desc="Inventory & stock ledger"
          color="var(--color-success)"
        />
        <QuickCard
          id="nav-invoices"
          to="/admin/invoices"
          icon="🧾"
          title="Invoices"
          desc="Supplier &amp; customer records"
          color="var(--color-info)"
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
