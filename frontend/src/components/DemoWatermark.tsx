/**
 * DemoWatermark: faint diagonal text plus a banner on every screen.
 *
 * Enabled only when built with VITE_DEMO_WATERMARK=true (see docs/DEPLOY.md section 8).
 *   - pointer-events: none, so taps and the camera scanner are not blocked
 *   - hidden when printing, so printed labels and reports stay clean
 */

const DEMO_ON = import.meta.env.VITE_DEMO_WATERMARK === 'true';

const TILE_TEXT = 'DEMO - SPACE EXSPACE - NOT FOR PRODUCTION';

const tileSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="420" height="200">' +
  `<text x="20" y="110" transform="rotate(-30 210 100)" font-family="Arial, sans-serif" ` +
  `font-size="16" font-weight="700" fill="rgba(10,10,10,0.07)">${TILE_TEXT}</text></svg>`;

const tileUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(tileSvg)}")`;

export function DemoWatermark() {
  if (!DEMO_ON) return null;

  return (
    <>
      <style>{'@media print { .demo-watermark, .demo-banner { display: none !important; } }'}</style>

      <div
        className="demo-watermark"
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 9000,
          backgroundImage: tileUrl,
          backgroundRepeat: 'repeat',
        }}
      />

      <div
        className="demo-banner"
        role="note"
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 8,
          transform: 'translateX(-50%)',
          pointerEvents: 'none',
          zIndex: 9001,
          background: 'rgba(180, 83, 9, 0.92)',
          color: '#FFFFF0',
          fontSize: 12,
          fontWeight: 600,
          padding: '4px 12px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
        }}
      >
        Demo environment, sample data only
      </div>
    </>
  );
}
