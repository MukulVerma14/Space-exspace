/**
 * Demo mode flag. Set DEMO_WATERMARK=true in backend/.env to stamp printed label
 * sheets with a DEMO marker. The frontend has its own flag: VITE_DEMO_WATERMARK.
 */
export function isDemoWatermarkEnabled(): boolean {
  return process.env.DEMO_WATERMARK === 'true';
}

export const DEMO_STAMP_HTML =
  '<div class="demo-stamp" style="position:fixed;top:4mm;right:4mm;z-index:9999;' +
  'border:2px solid #DC2626;color:#DC2626;font:700 11pt Arial,sans-serif;' +
  'padding:2px 8px;background:#fff;pointer-events:none;">DEMO - NOT FOR PRODUCTION</div>';
