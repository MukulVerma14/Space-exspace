/**
 * Client clock offset calibration.
 *
 * WHY CLOCK CALIBRATION:
 * Field devices may have drifted system clocks (or misconfigured time zones).
 * The backend enforces a strict clock skew check on sync events (rejecting if
 * occurred_at is > 5 minutes in the future).
 *
 * CALIBRATION FORMULA (docs/API.md Endpoint 24):
 *   Δt = server_time - client_now
 *   calibrated_occurred_at = client_now + Δt
 *
 * PERSISTENCE:
 * The offset is saved to localStorage so when the technician goes into an
 * offline dead zone, subsequent enqueued actions continue to use the last
 * calibrated server offset.
 */

const CLOCK_OFFSET_KEY = 'sx_clock_offset_ms';

function loadPersistedOffset(): number {
  if (typeof localStorage === 'undefined') return 0;
  const val = localStorage.getItem(CLOCK_OFFSET_KEY);
  if (!val) return 0;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? 0 : parsed;
}

let currentOffsetMs: number = loadPersistedOffset();

/**
 * Returns the current calibrated offset in milliseconds.
 */
export function getClockOffset(): number {
  return currentOffsetMs;
}

/**
 * Sets the clock offset and persists it for offline survival.
 */
export function setClockOffset(offsetMs: number): void {
  currentOffsetMs = offsetMs;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(CLOCK_OFFSET_KEY, offsetMs.toString());
  }
}

/**
 * Calibrates clock offset from server time (ISO string, Date, or epoch ms).
 * Returns the computed delta in milliseconds.
 */
export function calibrateClockFromServerTime(serverTime: string | Date | number): number {
  const serverMs =
    typeof serverTime === 'number'
      ? serverTime
      : serverTime instanceof Date
      ? serverTime.getTime()
      : Date.parse(serverTime);

  if (isNaN(serverMs)) {
    return currentOffsetMs;
  }

  const offset = serverMs - Date.now();
  setClockOffset(offset);
  return offset;
}

/**
 * Returns the current time adjusted by the calibrated server clock offset as an ISO 8601 string.
 */
export function getCalibratedNowIso(): string {
  const calibratedTime = Date.now() + currentOffsetMs;
  return new Date(calibratedTime).toISOString();
}

/**
 * Resets clock offset to 0 (useful in tests and user switches).
 */
export function resetClockOffset(): void {
  currentOffsetMs = 0;
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(CLOCK_OFFSET_KEY);
  }
}
