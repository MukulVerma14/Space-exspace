/**
 * PwaUpdateBanner — Notifies users when a new service worker is waiting,
 * rendering a visible "New version available, refresh" banner with a one-click
 * action that activates the update and reloads the page.
 */

import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaUpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (registration) {
        // Periodically check for service worker updates (every hour)
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);
      }
    },
    onRegisterError(error) {
      console.error('[PWA] Service worker registration error:', error);
    },
  });

  if (!needRefresh) {
    return null;
  }

  return (
    <div
      id="pwa-update-banner"
      role="alert"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 'var(--space-3)',
        padding: 'var(--space-3) var(--space-4)',
        background: '#8A6914',
        color: '#FFFFFF',
        boxShadow: 'var(--shadow-md)',
        borderBottom: '2px solid #D3B678',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: '1.25rem' }} aria-hidden="true">🔄</span>
        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
          New version available, refresh
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          type="button"
          id="pwa-refresh-btn"
          className="btn"
          onClick={() => updateServiceWorker(true)}
          style={{
            background: '#FFFFFF',
            color: '#8A6914',
            padding: 'var(--space-1) var(--space-3)',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Refresh Now
        </button>
        <button
          type="button"
          id="pwa-dismiss-btn"
          aria-label="Dismiss banner"
          onClick={() => setNeedRefresh(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#FFFFFF',
            cursor: 'pointer',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-sm)',
            lineHeight: 1,
            opacity: 0.8,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default PwaUpdateBanner;
