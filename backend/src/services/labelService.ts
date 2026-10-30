import QRCode from 'qrcode';

export interface EquipmentLabelData {
  asset_code: string;
  serial_no: string;
  make: string;
  model: string;
  type_name: string;
  capacity_value: string | number | null;
  capacity_unit: string | null;
  current_location_name: string | null;
}

export interface RenderedLabelItem extends EquipmentLabelData {
  qr_data_url: string;
}

/**
 * Generates a base64 PNG data URL for a given plain asset_code.
 * Error correction level is explicitly set to 'H' (High, ~30% recovery)
 * to ensure outdoor labels exposed to dust, oil, and scratches still scan.
 */
export async function generateQrCodeDataUrl(assetCode: string): Promise<string> {
  return QRCode.toDataURL(assetCode, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 256,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

/**
 * Builds the complete printable A4 HTML grid document containing QR codes,
 * large asset codes, and technical type/model metadata.
 * STRICT INVARIANT: ZERO financial or commercial fields are included.
 */
export function renderPrintableHtmlGrid(items: RenderedLabelItem[]): string {
  const cardsHtml = items
    .map((item) => {
      const specLine = item.capacity_value
        ? `<div class="item-spec">Capacity: ${escapeHtml(String(item.capacity_value))} ${escapeHtml(item.capacity_unit || '')}</div>`
        : '';
      const locationLine = item.current_location_name
        ? `<div class="item-location">Base: ${escapeHtml(item.current_location_name)}</div>`
        : '';

      return `
      <div class="label-card">
        <div class="qr-container">
          <img src="${item.qr_data_url}" alt="QR code for ${escapeHtml(item.asset_code)}" />
        </div>
        <div class="label-info">
          <div class="brand-tag">SPACE EXSPACE</div>
          <div class="asset-code">${escapeHtml(item.asset_code)}</div>
          <div class="item-model">${escapeHtml(item.make)} ${escapeHtml(item.model)}</div>
          <div class="item-type">${escapeHtml(item.type_name)}</div>
          ${specLine}
          ${locationLine}
          <div class="serial-tag">S/N: ${escapeHtml(item.serial_no)}</div>
        </div>
      </div>
      `;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SPACE EXSPACE - Equipment QR Labels Sheet</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    @media print {
      body {
        margin: 0;
        background: #ffffff !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print {
        display: none !important;
      }
      .label-card {
        page-break-inside: avoid;
        break-inside: avoid;
      }
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background: #f3f4f6;
      margin: 0;
      padding: 16px;
    }
    .sheet-toolbar {
      max-width: 210mm;
      margin: 0 auto 16px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #ffffff;
      padding: 12px 18px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .sheet-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: #1f2937;
    }
    .sheet-meta {
      font-size: 0.85rem;
      color: #4b5563;
    }
    .print-button {
      background-color: #2563eb;
      color: #ffffff;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .print-button:hover {
      background-color: #1d4ed8;
    }
    .sheet-page {
      max-width: 210mm;
      margin: 0 auto;
      background: #ffffff;
      padding: 10mm;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      border-radius: 4px;
    }
    .sheet-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8mm;
    }
    .label-card {
      border: 2px solid #111827;
      border-radius: 6px;
      padding: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
      background: #ffffff;
      min-height: 48mm;
    }
    .qr-container {
      flex-shrink: 0;
      width: 110px;
      height: 110px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr-container img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      image-rendering: pixelated;
    }
    .label-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      overflow: hidden;
    }
    .brand-tag {
      font-size: 0.65rem;
      font-weight: 800;
      letter-spacing: 1.5px;
      color: #4b5563;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .asset-code {
      font-size: 1.55rem;
      font-weight: 900;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      color: #000000;
      letter-spacing: 0.5px;
      line-height: 1.1;
      margin-bottom: 4px;
    }
    .item-model {
      font-size: 0.92rem;
      font-weight: 700;
      color: #111827;
      line-height: 1.2;
    }
    .item-type {
      font-size: 0.8rem;
      color: #374151;
      margin-top: 2px;
    }
    .item-spec, .item-location {
      font-size: 0.75rem;
      color: #4b5563;
      margin-top: 1px;
    }
    .serial-tag {
      font-size: 0.7rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
      color: #6b7280;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="sheet-toolbar no-print">
    <div>
      <div class="sheet-title">Printable Equipment QR Labels (${items.length} labels)</div>
      <div class="sheet-meta">Standard A4 Sheet (2x4 Grid per page, Plain natural key payload, Error Correction: High)</div>
    </div>
    <button class="print-button" onclick="window.print()">Print Labels (A4)</button>
  </div>
  <div class="sheet-page">
    <div class="sheet-grid">
      ${cardsHtml}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
