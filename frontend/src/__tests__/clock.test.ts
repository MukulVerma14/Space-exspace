import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  calibrateClockFromServerTime,
  getCalibratedNowIso,
  getClockOffset,
  resetClockOffset,
  setClockOffset,
} from '../offline/clock';

describe('offline clock calibration', () => {
  const mockStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.restoreAllMocks();

    for (const key in mockStorage) {
      delete mockStorage[key];
    }

    const localStorageMock = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        for (const key in mockStorage) delete mockStorage[key];
      },
    };

    vi.stubGlobal('localStorage', localStorageMock);
    resetClockOffset();
  });

  it('starts with 0 offset if uncalibrated', () => {
    expect(getClockOffset()).toBe(0);
  });

  it('calibrates positive offset when client clock is behind server', () => {
    const fixedNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    // Server time is 10 minutes (600,000 ms) ahead of client
    const serverTime = new Date(fixedNow + 600000).toISOString();
    const offset = calibrateClockFromServerTime(serverTime);

    expect(offset).toBe(600000);
    expect(getClockOffset()).toBe(600000);

    const calibratedIso = getCalibratedNowIso();
    expect(calibratedIso).toBe(serverTime);
  });

  it('calibrates negative offset when client clock is ahead of server', () => {
    const fixedNow = 1700000000000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    // Server time is 5 minutes (300,000 ms) behind client
    const serverTime = new Date(fixedNow - 300000).toISOString();
    const offset = calibrateClockFromServerTime(serverTime);

    expect(offset).toBe(-300000);
    expect(getClockOffset()).toBe(-300000);

    const calibratedIso = getCalibratedNowIso();
    expect(calibratedIso).toBe(serverTime);
  });

  it('persists calibrated offset across sessions and recovers on reload', () => {
    setClockOffset(125000);
    expect(getClockOffset()).toBe(125000);
    expect(localStorage.getItem('sx_clock_offset_ms')).toBe('125000');
  });

  it('handles invalid server date gracefully without altering current offset', () => {
    setClockOffset(5000);
    const unchanged = calibrateClockFromServerTime('invalid-date-string');
    expect(unchanged).toBe(5000);
    expect(getClockOffset()).toBe(5000);
  });
});
