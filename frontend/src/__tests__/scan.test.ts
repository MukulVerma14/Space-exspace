import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import qrcode from 'qrcode';
import { PNG } from 'pngjs';
import { resolveEquipmentByCode } from '../data/equipmentSource';
import { parseCameraError } from '../utils/cameraErrors';
import { decodeFrame, computeScaledDimensions } from '../utils/qrDecoder';
import { ScannerEngine } from '../utils/scannerEngine';
import * as dbModule from '../offline/db';
import { api } from '../api/client';

describe('Scan System & QR Protocol (F-S1 & F-S6)', () => {
  const sampleLabelQrCodes = [
    'CRN-50-001',
    'GEN-250-001',
    'FLT-07-001',
    'EXC-20-001',
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Pure decodeFrame with real QR PNG (jsQR + qrcode + pngjs)', () => {
    it.each(sampleLabelQrCodes)(
      'decodes real generated QR PNG for "%s" without browser canvas',
      async (code) => {
        // Generate real QR code as PNG buffer using qrcode package
        const pngBuffer = await qrcode.toBuffer(code, {
          type: 'png',
          errorCorrectionLevel: 'H',
          margin: 2,
          width: 300,
        });

        // Parse with pngjs
        const png = PNG.sync.read(pngBuffer);

        // Decode with pure decodeFrame function
        const decoded = decodeFrame({
          data: new Uint8ClampedArray(png.data),
          width: png.width,
          height: png.height,
        });

        expect(decoded).toBe(code);
      }
    );

    it('returns null when given blank, empty, or non-QR image data', () => {
      // 50x50 solid blank image
      const blankData = new Uint8ClampedArray(50 * 50 * 4);
      expect(decodeFrame({ data: blankData, width: 50, height: 50 })).toBeNull();
      expect(decodeFrame({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBeNull();
    });

    it('computeScaledDimensions correctly scales video frames to max 640px wide', () => {
      // 1280x720 (16:9) scales down to 640x360
      const scaled169 = computeScaledDimensions(1280, 720, 640);
      expect(scaled169.width).toBe(640);
      expect(scaled169.height).toBe(360);

      // Smaller frame 320x240 remains untouched
      const scaledSmall = computeScaledDimensions(320, 240, 640);
      expect(scaledSmall.width).toBe(320);
      expect(scaledSmall.height).toBe(240);

      // 1920x1080 scales down to 640x360
      const scaled1080 = computeScaledDimensions(1920, 1080, 640);
      expect(scaled1080.width).toBe(640);
      expect(scaled1080.height).toBe(360);
    });
  });

  describe('ScannerEngine Lifecycle & State Machine (F-S6)', () => {
    function createMockTrack() {
      return {
        stop: vi.fn(),
        kind: 'video',
        enabled: true,
      };
    }

    function createMockStream() {
      const track = createMockTrack();
      return {
        getTracks: vi.fn(() => [track]),
        getVideoTracks: vi.fn(() => [track]),
        _track: track,
      };
    }

    function createMockVideo() {
      const listeners: Record<string, (() => void)[]> = {};
      return {
        srcObject: null as any,
        readyState: 4,
        videoWidth: 640,
        videoHeight: 480,
        currentTime: 1.0,
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        addEventListener: vi.fn((event: string, cb: () => void) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(cb);
        }),
        removeEventListener: vi.fn((event: string, cb: () => void) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter((c) => c !== cb);
          }
        }),
        _trigger: (event: string) => {
          listeners[event]?.forEach((cb) => cb());
        },
      } as unknown as HTMLVideoElement;
    }

    it('starts camera stream and is idempotent when start() is called twice', async () => {
      const mockStream = createMockStream();
      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      });

      const video = createMockVideo();
      const onScan = vi.fn();
      const onError = vi.fn();
      const stateHistory: string[] = [];

      const engine = new ScannerEngine({
        videoElement: video,
        onScan,
        onError,
        onStateChange: (state) => stateHistory.push(state),
      });

      expect(engine.getState()).toBe('idle');

      // Call start twice in parallel
      const p1 = engine.start();
      const p2 = engine.start();

      await Promise.all([p1, p2]);

      // getUserMedia called only once due to starting guard
      expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
      expect(engine.getState()).toBe('running');
      expect(video.srcObject).toBe(mockStream);
      expect(video.play).toHaveBeenCalledTimes(1);
    });

    it('cancels and stops tracks if stop() is called while start() is in flight', async () => {
      let resolveGetUserMedia: (stream: any) => void = () => {};
      const getUserMediaPromise = new Promise((resolve) => {
        resolveGetUserMedia = resolve;
      });

      const mockGetUserMedia = vi.fn().mockReturnValue(getUserMediaPromise);
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      });

      const video = createMockVideo();
      const onScan = vi.fn();
      const onError = vi.fn();

      const engine = new ScannerEngine({
        videoElement: video,
        onScan,
        onError,
      });

      // 1. Kick off start()
      const startPromise = engine.start();
      expect(engine.getState()).toBe('starting');

      // 2. Call stop() before getUserMedia resolves (e.g. fast user back navigation or StrictMode)
      engine.stop();
      expect(engine.getState()).toBe('idle');

      // 3. getUserMedia resolves later
      const delayedStream = createMockStream();
      resolveGetUserMedia(delayedStream);
      await startPromise;

      // Stream tracks must be stopped immediately upon resolution
      expect((delayedStream as any)._track.stop).toHaveBeenCalled();
      // Video must NOT have received srcObject
      expect(video.srcObject).toBeNull();
      expect(engine.getState()).toBe('idle');
    });

    it('retry() cleanly cancels an in-flight start and starts a fresh session', async () => {
      let resolveFirstGetUserMedia: (stream: any) => void = () => {};
      const firstStreamPromise = new Promise((resolve) => {
        resolveFirstGetUserMedia = resolve;
      });

      const secondStream = createMockStream();
      const mockGetUserMedia = vi
        .fn()
        .mockReturnValueOnce(firstStreamPromise)
        .mockResolvedValueOnce(secondStream);

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      });

      const video = createMockVideo();
      const onScan = vi.fn();
      const onError = vi.fn();

      const engine = new ScannerEngine({
        videoElement: video,
        onScan,
        onError,
      });

      // First start in-flight
      const startPromise1 = engine.start();
      expect(engine.getState()).toBe('starting');

      // Retry called while first start is in-flight
      const retryPromise = engine.retry();

      // First stream eventually resolves
      const firstStream = createMockStream();
      resolveFirstGetUserMedia(firstStream);

      await Promise.all([startPromise1, retryPromise]);

      // First stream tracks stopped because its session was aborted
      expect((firstStream as any)._track.stop).toHaveBeenCalled();
      // Second stream is active
      expect(video.srcObject).toBe(secondStream);
      expect(engine.getState()).toBe('running');
    });

    it('cleans up all resources on unmount (stop)', async () => {
      const mockStream = createMockStream();
      const mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
        },
      });

      const video = createMockVideo();
      const engine = new ScannerEngine({
        videoElement: video,
        onScan: vi.fn(),
        onError: vi.fn(),
      });

      await engine.start();
      expect(engine.getState()).toBe('running');

      // Simulate unmount cleanup
      engine.stop();

      expect(engine.getState()).toBe('idle');
      expect((mockStream as any)._track.stop).toHaveBeenCalled();
      expect(video.srcObject).toBeNull();
    });

    it('triggers WatchdogTimeoutError when no video frames arrive within watchdog interval', async () => {
      vi.useFakeTimers();

      const mockStream = createMockStream();
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
        },
      });

      // Video with 0x0 size (never delivered frame)
      const frozenVideo = createMockVideo();
      (frozenVideo as any).videoWidth = 0;
      (frozenVideo as any).videoHeight = 0;

      const onError = vi.fn();
      const engine = new ScannerEngine({
        videoElement: frozenVideo,
        onScan: vi.fn(),
        onError,
        watchdogTimeoutMs: 8000,
      });

      const startPromise = engine.start();
      await vi.advanceTimersByTimeAsync(100);
      await startPromise;

      // Advance watchdog by 8000ms
      await vi.advanceTimersByTimeAsync(8000);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'WatchdogTimeoutError',
          hint: expect.stringMatching(/delivered no video frames within 8 seconds/i),
        })
      );
      expect(engine.getState()).toBe('idle');
    });
  });

  describe('QR Scanner Cooldown (3-Second Debounce Rule)', () => {
    it('ignores duplicate reads of the exact same code within 3000ms', () => {
      vi.useFakeTimers();
      const onScanCallback = vi.fn();

      let lastCode: string | null = null;
      let lastTime = 0;
      const SCAN_COOLDOWN_MS = 3000;

      function simulateScan(decodedText: string) {
        const clean = decodedText.trim();
        const now = Date.now();
        if (clean.toLowerCase() === lastCode?.toLowerCase() && now - lastTime < SCAN_COOLDOWN_MS) {
          return;
        }
        lastCode = clean;
        lastTime = now;
        onScanCallback(clean);
      }

      // 1. Initial read of QR printed from /api/labels/sheet
      simulateScan('CRN-50-001');
      expect(onScanCallback).toHaveBeenCalledTimes(1);
      expect(onScanCallback).toHaveBeenCalledWith('CRN-50-001');

      // 2. Camera reads same QR code 500ms later (e.g. at 5-8 fps)
      vi.advanceTimersByTime(500);
      simulateScan('CRN-50-001');
      expect(onScanCallback).toHaveBeenCalledTimes(1); // Ignored!

      // 3. Camera reads same QR code at 2500ms
      vi.advanceTimersByTime(2000);
      simulateScan('CRN-50-001');
      expect(onScanCallback).toHaveBeenCalledTimes(1); // Still ignored!

      // 4. Camera reads same QR code at 3100ms (> 3 seconds)
      vi.advanceTimersByTime(600);
      simulateScan('CRN-50-001');
      expect(onScanCallback).toHaveBeenCalledTimes(2); // Accepted after cooldown!
    });

    it('immediately accepts a different asset code even within 3000ms', () => {
      vi.useFakeTimers();
      const onScanCallback = vi.fn();

      let lastCode: string | null = null;
      let lastTime = 0;
      const SCAN_COOLDOWN_MS = 3000;

      function simulateScan(decodedText: string) {
        const clean = decodedText.trim();
        const now = Date.now();
        if (clean.toLowerCase() === lastCode?.toLowerCase() && now - lastTime < SCAN_COOLDOWN_MS) {
          return;
        }
        lastCode = clean;
        lastTime = now;
        onScanCallback(clean);
      }

      simulateScan('CRN-50-001');
      expect(onScanCallback).toHaveBeenCalledTimes(1);

      // Advance by only 200ms, but scan another machine tag
      vi.advanceTimersByTime(200);
      simulateScan('GEN-250-001');
      expect(onScanCallback).toHaveBeenCalledTimes(2);
      expect(onScanCallback).toHaveBeenLastCalledWith('GEN-250-001');
    });
  });

  describe('Testing against QR codes printed from /api/labels/sheet', () => {
    it.each(sampleLabelQrCodes)(
      'successfully resolves QR payload "%s" generated by label sheet service',
      async (assetCode) => {
        vi.stubGlobal('navigator', { onLine: true });

        // Backend /api/labels/sheet encodes plain asset code (ADR 014)
        const dummyEquipment = {
          id: 42,
          asset_code: assetCode,
          make: 'Caterpillar',
          model: 'Cat-2026',
          type_name: 'Industrial Generator',
          serial_no: 'SN-998877',
          condition: 'good' as const,
          status: 'available' as const,
          current_location_name: 'Dammam Yard',
          current_location_kind: 'yard',
          active: true,
          location_history: [],
          active_rental: null,
          open_maintenance: null,
        };

        vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
          data: [dummyEquipment],
          savedAt: '2026-11-06T10:00:00Z',
        });
        vi.spyOn(api, 'get').mockResolvedValueOnce(dummyEquipment);

        // Resolve code
        const result = await resolveEquipmentByCode(assetCode, 1);

        expect(result.source).toBe('live');
        expect(result.equipment?.asset_code).toBe(assetCode);
        expect(result.equipment?.make).toBe('Caterpillar');
        expect(result.error).toBeNull();
      }
    );

    it('normalizes whitespace and case in QR scans from outdoor tags', async () => {
      vi.stubGlobal('navigator', { onLine: true });

      const dummyEquipment = {
        id: 1,
        asset_code: 'CRN-50-001',
        make: 'Tadano',
        model: 'GR-500EX',
        type_name: 'Rough Terrain Crane',
        serial_no: 'TD-500-9841',
        condition: 'good' as const,
        status: 'available' as const,
        current_location_name: 'Dammam Yard',
        current_location_kind: 'yard',
        active: true,
      };

      vi.spyOn(dbModule, 'loadSnapshot').mockResolvedValueOnce({
        data: [dummyEquipment],
        savedAt: '2026-11-06T10:00:00Z',
      });
      vi.spyOn(api, 'get').mockResolvedValueOnce(dummyEquipment);

      // Raw scanner input with trailing carriage returns / spaces
      const rawScannedPayload = '  crn-50-001\r\n ';
      const result = await resolveEquipmentByCode(rawScannedPayload, 1);

      expect(result.equipment?.asset_code).toBe('CRN-50-001');
    });
  });

  describe('Camera Failure & Fallback Handling (F-S5 Diagnostics)', () => {
    it('identifies unsupported browser environment when getUserMedia is missing', () => {
      const mockNavigator = {};
      const isSupported =
        !!(mockNavigator as any).mediaDevices &&
        typeof (mockNavigator as any).mediaDevices.getUserMedia === 'function';
      expect(isSupported).toBe(false);
    });

    describe('parseCameraError mapping', () => {
      it('correctly diagnoses NotAllowedError with permission hint', () => {
        const err = new DOMException('Permission denied', 'NotAllowedError');
        const diag = parseCameraError(err);
        expect(diag.name).toBe('NotAllowedError');
        expect(diag.message).toBe('Permission denied');
        expect(diag.hint).toMatch(/permission was denied/i);
      });

      it('correctly diagnoses NotFoundError with hardware missing hint', () => {
        const err = new DOMException('Requested device not found', 'NotFoundError');
        const diag = parseCameraError(err);
        expect(diag.name).toBe('NotFoundError');
        expect(diag.message).toBe('Requested device not found');
        expect(diag.hint).toMatch(/no physical camera was detected/i);
      });

      it('correctly diagnoses NotReadableError with in-use hint', () => {
        const err = new DOMException('Could not start video source', 'NotReadableError');
        const diag = parseCameraError(err);
        expect(diag.name).toBe('NotReadableError');
        expect(diag.message).toBe('Could not start video source');
        expect(diag.hint).toMatch(/in use by another application/i);
      });

      it('correctly diagnoses OverconstrainedError with constraint hint', () => {
        const err = new DOMException('Constraints could not be satisfied', 'OverconstrainedError');
        const diag = parseCameraError(err);
        expect(diag.name).toBe('OverconstrainedError');
        expect(diag.message).toBe('Constraints could not be satisfied');
        expect(diag.hint).toMatch(/constraints.*could not be satisfied/i);
      });

      it('correctly diagnoses SecurityError with secure context hint', () => {
        const err = new DOMException('Only secure origins are allowed', 'SecurityError');
        const diag = parseCameraError(err);
        expect(diag.name).toBe('SecurityError');
        expect(diag.message).toBe('Only secure origins are allowed');
        expect(diag.hint).toMatch(/secure context.*permissions-policy/i);
      });

      it('correctly parses WatchdogTimeoutError with timeout hint', () => {
        const diag = parseCameraError('WatchdogTimeoutError: Camera stream was established but delivered no video frames within 8 seconds.');
        expect(diag.name).toBe('WatchdogTimeoutError');
        expect(diag.hint).toMatch(/delivered no video frames within 8 seconds/i);
      });

      it('correctly parses plain string error messages', () => {
        const diag = parseCameraError('NotAllowedError: Permission denied by system');
        expect(diag.name).toBe('NotAllowedError');
        expect(diag.hint).toMatch(/permission was denied/i);
      });

      it('handles unknown / generic errors with fallback hint', () => {
        const diag = parseCameraError(new Error('Hardware bus failure'));
        expect(diag.name).toBe('Error');
        expect(diag.message).toBe('Hardware bus failure');
        expect(diag.hint).toMatch(/could not access camera/i);
      });
    });
  });
});
