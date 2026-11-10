/**
 * Pure QR Code decoding utility for SPACE EXSPACE (F-S6).
 *
 * Powered by jsQR: lightweight (~40KB), zero-DOM dependencies, fast CPU decoding.
 * Decodes from raw pixel buffers (ImageData or node PNG buffers).
 */

import jsQR from 'jsqr';

export interface DecodableImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Pure function to decode a QR code from image pixel buffer using jsQR.
 * Works with ImageData from HTML5 canvas as well as PNG buffer pixel data in tests.
 */
export function decodeFrame(imageData: DecodableImageData): string | null {
  if (!imageData || !imageData.data || imageData.width <= 0 || imageData.height <= 0) {
    return null;
  }
  try {
    const code = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (code && code.data) {
      const clean = code.data.trim();
      return clean.length > 0 ? clean : null;
    }
  } catch (err) {
    console.warn('[qrDecoder] Decoding error:', err);
  }
  return null;
}

/**
 * Computes destination canvas dimensions scaled down to maxWidth (default 640px)
 * while preserving source aspect ratio.
 */
export function computeScaledDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth = 640
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: 0, height: 0 };
  }
  if (sourceWidth <= maxWidth) {
    return { width: sourceWidth, height: sourceHeight };
  }
  const scale = maxWidth / sourceWidth;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
