/**
 * OutboxBadge: shows how many staff actions are waiting to be sent.
 *
 *   "N pending"   — saved on this phone, not yet sent (F-O4 sends them)
 *   "N to review" — the server rejected them; the reason is shown, the person decides
 *
 * Clicking opens a panel with the list. Rejected items can be discarded.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSync } from '../hooks/useSync';
import { resetSyncAuth, runSync } from '../sync/syncManager';
import { simulateNext401 } from '../sync/syncClient';
import { useOutbox } from '../hooks/useOutbox';
import { discardEvent, enqueueEvent, markRejected } from '../offline/outbox';

export function OutboxBadge() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { events, pending, rejected } = useOutbox(user?.id ?? null);
  const sync = useSync();
  const [open, setOpen] = useState(false);

  // Hidden when there is nothing to show. In dev builds it stays visible so the test buttons are reachable.
  if (!user || (events.length === 0 && !import.meta.env.DEV)) return null;

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          padding: 'var(--space-1) var(--space-3)',
          borderRadius: 'var(--radius-full)',
          border: `1px solid ${rejected > 0 ? 'var(--color-danger)' : 'var(--color-warning)'}`,
          background: 'transparent',
          color: rejected > 0 ? 'var(--color-danger)' : 'var(--color-warning)',
          fontSize: 'var(--text-xs)',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {rejected > 0 ? `${rejected} to review` : `${pending} pending`}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Unsent changes"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + var(--space-2))',
            width: 320,
            maxHeight: 360,
            overflowY: 'auto',
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3)',
            zIndex: 50,
            fontSize: 'var(--text-sm)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)' }}>
            {pending} pending · {rejected} to review
          </div>

          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
            {sync.running
              ? 'Sending…'
              : sync.lastError
                ? sync.lastError
                : sync.lastSyncAt
                  ? `Last sent ${new Date(sync.lastSyncAt).toLocaleTimeString()}`
                  : 'Not sent yet'}
          </div>

          {sync.authExpired ? (
            <button
              type="button"
              onClick={async () => {
                resetSyncAuth();
                await logout(); // keeps the outbox: only the token and snapshots are cleared
                navigate('/login', { replace: true });
              }}
              style={{ marginBottom: 'var(--space-2)', cursor: 'pointer' }}
            >
              Sign in again
            </button>
          ) : (
            <button
              type="button"
              disabled={sync.running || pending === 0 || !user}
              onClick={() => user && runSync(user.id)}
              style={{ marginBottom: 'var(--space-2)', cursor: 'pointer' }}
            >
              Sync now
            </button>
          )}

          {events.map((ev) => (
            <div
              key={ev.id}
              style={{
                padding: 'var(--space-2) 0',
                borderTop: '1px solid var(--color-border-subtle)',
              }}
            >
              <div>
                <strong>{ev.type.replace('_', ' ')}</strong> · {ev.assetCode}
              </div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
                {new Date(ev.occurredAt).toLocaleString()}
              </div>

              {ev.status === 'rejected' && (
                <>
                  <div style={{ color: 'var(--color-danger)', marginTop: 4 }}>
                    Server: {ev.rejectReason ?? 'rejected'}
                  </div>
                  <button
                    type="button"
                    onClick={() => discardEvent(ev.id)}
                    style={{ marginTop: 4, fontSize: 'var(--text-xs)', cursor: 'pointer' }}
                  >
                    Discard
                  </button>
                </>
              )}
            </div>
          ))}

          {import.meta.env.DEV && (
            <div style={{ borderTop: '1px dashed var(--color-border-subtle)', marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 4 }}>
                Dev only
              </div>
              <button
                type="button"
                onClick={() =>
                  enqueueEvent({
                    userId: user.id,
                    type: 'move',
                    assetCode: 'CRN-50-001',
                    payload: { location: 'Dammam Main Yard' },
                  })
                }
                style={{ fontSize: 'var(--text-xs)', cursor: 'pointer', marginRight: 8 }}
              >
                + test event
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ev = await enqueueEvent({
                    userId: user.id,
                    type: 'send_to_repair',
                    assetCode: 'CRN-25-001',
                    payload: { note: 'hydraulic hose' },
                  });
                  await markRejected(ev.id, 'Asset is already under repair (test)');
                }}
                style={{ fontSize: 'var(--text-xs)', cursor: 'pointer' }}
              >
                + test rejected
              </button>
              <button
                type="button"
                onClick={() =>
                  enqueueEvent({
                    userId: user.id,
                    type: 'send_to_repair',
                    assetCode: 'CRN-25-001',
                    payload: { note: 'test, mock server rejects this type' },
                  })
                }
                style={{ fontSize: 'var(--text-xs)', cursor: 'pointer', marginLeft: 8 }}
              >
                + test pending repair
              </button>
              <button
                type="button"
                onClick={() => simulateNext401()}
                style={{ fontSize: 'var(--text-xs)', cursor: 'pointer', marginLeft: 8 }}
              >
                sim 401 next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
