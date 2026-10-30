import { useSyncExternalStore } from 'react';
import { getSyncStatus, subscribeSync, SyncStatus } from '../sync/syncManager';

/** Live sync status for the UI. */
export function useSync(): SyncStatus {
  return useSyncExternalStore(subscribeSync, getSyncStatus, getSyncStatus);
}
