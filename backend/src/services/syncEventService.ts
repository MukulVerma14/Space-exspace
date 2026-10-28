import { PoolClient, QueryResult } from 'pg';

export interface SyncEventRow {
  client_event_id: string;
  user_id: number;
  type: string;
  payload: Record<string, unknown>;
  status: 'accepted' | 'rejected' | 'duplicate';
  result: Record<string, unknown> | null;
  occurred_at: string | Date;
  recorded_at: string | Date;
}

export interface SaveSyncEventParams {
  client_event_id: string;
  user_id: number;
  type: string;
  payload: Record<string, unknown>;
  status: 'accepted' | 'rejected';
  result: Record<string, unknown> | null;
  occurred_at: string | Date;
}

/**
 * Checks if a client_event_id has already been processed.
 * If present, returns the existing stored result without modifying state (idempotency).
 */
export async function findSyncEventById(
  client: PoolClient,
  clientEventId: string
): Promise<SyncEventRow | null> {
  const res: QueryResult<SyncEventRow> = await client.query(
    `SELECT client_event_id, user_id, type, payload, status, result, occurred_at, recorded_at
     FROM sync_events
     WHERE client_event_id = $1`,
    [clientEventId]
  );

  return res.rows[0] || null;
}

/**
 * Persists an event execution outcome into the sync_events ledger.
 * Client-generated UUID PK ensures no two identical events can be processed concurrently.
 */
export async function persistSyncEvent(
  client: PoolClient,
  params: SaveSyncEventParams
): Promise<SyncEventRow> {
  const res: QueryResult<SyncEventRow> = await client.query(
    `INSERT INTO sync_events (
       client_event_id, user_id, type, payload, status, result, occurred_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING client_event_id, user_id, type, payload, status, result, occurred_at, recorded_at`,
    [
      params.client_event_id,
      params.user_id,
      params.type,
      JSON.stringify(params.payload),
      params.status,
      params.result ? JSON.stringify(params.result) : null,
      params.occurred_at,
    ]
  );

  return res.rows[0];
}
