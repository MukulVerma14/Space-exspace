/**
 * Camera error parsing and diagnostic utilities for SPACE EXSPACE.
 *
 * SPECIFICATION (F-S5):
 * Maps exact browser MediaDevices error names to clear, actionable plain-language hints:
 * - NotAllowedError: Permission denied by user or OS
 * - NotFoundError: No physical camera found or connected
 * - NotReadableError: Camera busy / locked by another application
 * - OverconstrainedError: Requested constraints (facingMode) cannot be satisfied
 * - SecurityError: Insecure context or Permissions-Policy blocked
 * - AbortError: Operation cancelled / hardware reset
 */

export interface CameraDiagnosticInfo {
  name: string;
  message: string;
  hint: string;
}

export function parseCameraError(err: unknown): CameraDiagnosticInfo {
  let name = 'UnknownError';
  let message = '';

  if (err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err)) {
    const errorObj = err as { name?: string; message?: string };
    name = errorObj.name || 'UnknownError';
    message = errorObj.message || String(err);
  } else if (typeof err === 'string') {
    message = err;
    if (
      err.includes('NotAllowedError') ||
      err.includes('PermissionDeniedError') ||
      err.toLowerCase().includes('permission denied')
    ) {
      name = 'NotAllowedError';
    } else if (
      err.includes('NotFoundError') ||
      err.includes('DevicesNotFoundError') ||
      err.toLowerCase().includes('not found')
    ) {
      name = 'NotFoundError';
    } else if (
      err.includes('NotReadableError') ||
      err.includes('TrackStartError') ||
      err.toLowerCase().includes('could not start video source')
    ) {
      name = 'NotReadableError';
    } else if (
      err.includes('OverconstrainedError') ||
      err.includes('ConstraintNotSatisfiedError')
    ) {
      name = 'OverconstrainedError';
    } else if (err.includes('SecurityError')) {
      name = 'SecurityError';
    } else if (err.includes('AbortError')) {
      name = 'AbortError';
    }
  } else {
    message = String(err);
  }

  // If the error object has a generic name (e.g. 'Error' or 'UnknownError') but message contains the DOMException name:
  if (name === 'UnknownError' || name === 'Error') {
    if (
      message.includes('NotAllowedError') ||
      message.includes('PermissionDeniedError') ||
      message.toLowerCase().includes('permission denied')
    ) {
      name = 'NotAllowedError';
    } else if (
      message.includes('NotFoundError') ||
      message.includes('DevicesNotFoundError') ||
      message.toLowerCase().includes('no device')
    ) {
      name = 'NotFoundError';
    } else if (
      message.includes('NotReadableError') ||
      message.includes('TrackStartError') ||
      message.toLowerCase().includes('could not start video source')
    ) {
      name = 'NotReadableError';
    } else if (
      message.includes('OverconstrainedError') ||
      message.includes('ConstraintNotSatisfiedError')
    ) {
      name = 'OverconstrainedError';
    } else if (message.includes('SecurityError')) {
      name = 'SecurityError';
    } else if (message.includes('AbortError')) {
      name = 'AbortError';
    }
  }

  let hint: string;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      hint =
        'Camera permission was denied. Please allow camera permissions in your browser address bar or device settings, or use manual asset-code entry below.';
      break;

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      hint =
        'No physical camera was detected on this device. Please connect a camera or use manual asset-code entry below.';
      break;

    case 'NotReadableError':
    case 'TrackStartError':
      hint =
        'The camera is currently locked or in use by another application or OS service. Please close other camera apps and retry.';
      break;

    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      hint =
        'The requested camera constraints (e.g. rear environment camera) could not be satisfied by available hardware.';
      break;

    case 'SecurityError':
      hint =
        'Camera access was blocked by security policy. Camera requires a Secure Context (HTTPS or localhost) and Permissions-Policy: camera=(self).';
      break;

    case 'AbortError':
      hint =
        'Camera initialization was aborted before it could complete. Please try scanning again.';
      break;

    default:
      hint = `Could not access camera (${name}: ${message || 'unspecified'}). Please check device settings or use manual asset-code entry below.`;
      break;
  }

  return { name, message: message || name, hint };
}
