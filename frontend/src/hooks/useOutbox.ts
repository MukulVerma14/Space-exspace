import { useCallback, useEffect, useState } from 'react';
import type { OutboxEvent } from '../offline/db';
import { listEvents, OUTBOX_CHANGED_EVENT } from '../offline/outbox';

/** Live view of the current user's outbox. Re-reads whenever the outbox changes. */
export function useOutbox(userId: number | null) {
  const [events, setEvents] = useState<OutboxEvent[]>([]);

  const refresh = useCallback(async () => {
    if (userId == null) {
      setEvents([]);
      return;
    }
    setEvents(await listEvents(userId));
  }, [userId]);

  useEffect(() => {
    refresh();
    window.addEventListener(OUTBOX_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, refresh);
  }, [refresh]);

  return {
    events,
    pending: events.filter((e) => e.status === 'pending').length,
    rejected: events.filter((e) => e.status === 'rejected').length,
  };
}
