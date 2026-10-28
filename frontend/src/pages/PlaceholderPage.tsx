/**
 * Placeholder page — used for routes that exist in the router but whose
 * full implementation is planned for a future step.
 */

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="animate-fade-up" style={{ textAlign: 'center', paddingTop: 'var(--space-16)' }}>
      <div style={{ fontSize: 48, marginBottom: 'var(--space-4)' }}>🚧</div>
      <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
        {title}
      </h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        This page will be implemented in a future step.
      </p>
    </div>
  );
}
