/**
 * OnlineStatusBadge
 *
 * Shows a small coloured pill indicating connectivity state.
 * Animates in/out on change so it draws attention without being intrusive.
 *
 * "Online" is shown briefly then fades to avoid persistent UI noise.
 * "Offline" persists — the user must know they are working offline.
 *
 * WHY SHOW AT ALL:
 * The client brief describes field technicians on construction sites and port terminals.
 * They may lose signal mid-task. Without a visible indicator they might submit
 * actions believing they went to the server, when in fact they were queued.
 * The badge is the contract between the app and the user: "I know you're
 * offline, your work is saved."
 */

import { useEffect, useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OnlineStatusBadge() {
  const online = useOnlineStatus();
  // Track transitions so we can briefly show "Back online" then hide
  const [prevOnline, setPrevOnline] = useState<boolean>(online);
  const [showOnlineBriefly, setShowOnlineBriefly] = useState(false);

  useEffect(() => {
    if (!prevOnline && online) {
      // Just came back online
      setShowOnlineBriefly(true);
      const t = setTimeout(() => setShowOnlineBriefly(false), 3000);
      setPrevOnline(true);
      return () => clearTimeout(t);
    }
    if (prevOnline && !online) {
      setPrevOnline(false);
      setShowOnlineBriefly(false);
    }
  }, [online, prevOnline]);

  // Nothing to show when stably online
  if (online && !showOnlineBriefly) return null;

  return (
    <div
      id="online-status-badge"
      role="status"
      aria-live="polite"
      aria-label={online ? 'Connection restored' : 'Working offline'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        letterSpacing: '0.03em',
        userSelect: 'none',
        animation: 'fadeUp 0.25s ease both',
        // Online = green, Offline = red
        background: online
          ? 'var(--color-success-dim)'
          : 'var(--color-danger-dim)',
        color: online
          ? 'var(--status-available)'
          : 'var(--color-danger)',
        border: `1px solid ${online ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
      }}
    >
      {/* Animated dot */}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
          animation: online ? 'none' : 'pulse 1.5s ease-in-out infinite',
        }}
        aria-hidden="true"
      />
      {online ? 'Online' : 'Offline — changes queued'}
    </div>
  );
}
