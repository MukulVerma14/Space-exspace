/**
 * useOnlineStatus — tracks browser navigator.onLine with event listeners.
 *
 * WHY A HOOK INSTEAD OF POLLING:
 * The client explicitly requires no polling while offline.
 * The browser fires 'online' and 'offline' events on the window object when
 * connectivity changes. We listen to those events — zero polling, zero API
 * calls, purely event-driven.
 *
 * LIMITATION: navigator.onLine is "optimistic" — it reflects whether the
 * browser has a network interface, not whether the network can actually reach
 * the server. A phone on a weak 4G signal may report online while all API
 * calls time out. The sync manager in F-O4 handles that case at the HTTP layer.
 */

import { useState, useEffect } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    function handleOnline() { setOnline(true); }
    function handleOffline() { setOnline(false); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
