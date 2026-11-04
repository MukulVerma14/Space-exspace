/**
 * NewSupplierInvoiceModal — Dynamic line item form for recording received supplier invoices.
 *
 * Requirements (F-I3):
 * - Form with dynamic lines (item, quantity, unit, unit price).
 * - Show computed totals but let the server be the authority.
 * - Show server errors clearly (validation, mismatch, duplicate 409).
 * - Debounce item search.
 * - Disable submit while in flight.
 * - Plain text file references only.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../hooks/useDebounce';
import { MaterialItem, loadMaterials } from '../data/materialsSource';
import {
  createSupplierInvoice,
  computeInvoiceTotals,
  formatMoney,
  CreateSupplierInvoicePayload,
} from '../data/invoicesSource';
import { ApiRequestError } from '../api/client';

interface NewSupplierInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newInvoiceId: number, invoiceNo: string) => void;
}

interface FormLine {
  id: string;
  item_id: number | null;
  item_sku: string;
  item_name: string;
  description: string;
  quantity: string;
  unit_id: number | null;
  unit_code: string;
  unit_price: string;
}

const SEEDED_SUPPLIERS = [
  { id: 1, name: 'Gulf Heavy Metals Trading' },
  { id: 2, name: 'Red Sea Industrial Hardware' },
  { id: 3, name: 'Eastern Coatings & Primers Co.' },
];

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function getFutureDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function createEmptyLine(): FormLine {
  return {
    id: Math.random().toString(36).substring(2, 9),
    item_id: null,
    item_sku: '',
    item_name: '',
    description: '',
    quantity: '1',
    unit_id: null,
    unit_code: 'EA',
    unit_price: '',
  };
}

export default function NewSupplierInvoiceModal({
  isOpen,
  onClose,
  onSuccess,
}: NewSupplierInvoiceModalProps) {
  const { user } = useAuth();

  // Catalog of materials for item selection
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Form Header State
  const [partyId, setPartyId] = useState<number>(1);
  const [customPartyId, setCustomPartyId] = useState<string>('');
  const [isCustomParty, setIsCustomParty] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayString());
  const [dueDate, setDueDate] = useState(getFutureDateString(30));
  const [notes, setNotes] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [recordStockReceipt, setRecordStockReceipt] = useState(true);

  // Dynamic Lines State
  const [lines, setLines] = useState<FormLine[]>([createEmptyLine()]);

  // Submission & Error State
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Fetch material catalog on open
  useEffect(() => {
    if (!isOpen || !user) return;
    setCatalogLoading(true);
    loadMaterials(user.id)
      .then((res) => {
        setCatalog(res.items);
        setCatalogLoading(false);
      })
      .catch(() => setCatalogLoading(false));
  }, [isOpen, user]);

  // Reset form when reopened
  useEffect(() => {
    if (isOpen) {
      setPartyId(1);
      setCustomPartyId('');
      setIsCustomParty(false);
      setInvoiceNo('');
      setInvoiceDate(getTodayString());
      setDueDate(getFutureDateString(30));
      setNotes('');
      setFileUrl('');
      setRecordStockReceipt(true);
      setLines([createEmptyLine()]);
      setServerError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Client-side computed totals (server remains final authority)
  const computedTotals = useMemo(() => {
    return computeInvoiceTotals(
      lines.map((l) => ({ quantity: l.quantity, unit_price: l.unit_price }))
    );
  }, [lines]);

  // Line modification helpers
  function updateLine(index: number, updates: Partial<FormLine>) {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, createEmptyLine()]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // Handle Form Submission
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const finalPartyId = isCustomParty ? parseInt(customPartyId, 10) : partyId;

    if (!finalPartyId || isNaN(finalPartyId) || finalPartyId <= 0) {
      setServerError('Please select or specify a valid supplier party ID.');
      return;
    }

    if (!invoiceNo.trim()) {
      setServerError('Invoice number is required.');
      return;
    }

    // Client-side validation of line items
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.item_id) {
        setServerError(`Line #${i + 1}: Please select a material item from the catalog.`);
        return;
      }
      const q = parseFloat(line.quantity);
      if (isNaN(q) || q <= 0) {
        setServerError(`Line #${i + 1}: Quantity must be greater than zero.`);
        return;
      }
      const p = parseFloat(line.unit_price);
      if (isNaN(p) || p < 0) {
        setServerError(`Line #${i + 1}: Unit price must be a non-negative number.`);
        return;
      }
      if (!line.unit_id) {
        setServerError(`Line #${i + 1}: Unit specification is missing.`);
        return;
      }
    }

    // Prepare payload (subtotal, vat_amount, and total sent as computed numbers)
    const payload: CreateSupplierInvoicePayload = {
      party_id: finalPartyId,
      invoice_no: invoiceNo.trim(),
      invoice_date: invoiceDate,
      due_date: dueDate,
      subtotal: computedTotals.subtotal,
      vat_amount: computedTotals.vat_amount,
      total: computedTotals.total,
      notes: notes.trim() ? notes.trim() : null,
      file_url: fileUrl.trim() ? fileUrl.trim() : null,
      record_stock_receipt: recordStockReceipt,
      lines: lines.map((l) => ({
        item_id: l.item_id!,
        description: l.description.trim() || l.item_name,
        quantity: parseFloat(l.quantity),
        unit_id: l.unit_id!,
        unit_price: parseFloat(l.unit_price),
      })),
    };

    setSubmitting(true);

    try {
      const res = await createSupplierInvoice(payload, user?.role);
      setSubmitting(false);
      onSuccess(res.invoice_id, res.invoice_no);
    } catch (err: unknown) {
      setSubmitting(false);
      if (err instanceof ApiRequestError) {
        const body = err.body as Record<string, unknown> | null;
        if (err.status === 409) {
          setServerError(
            `Duplicate Invoice (409): Invoice '${invoiceNo}' already exists for this supplier.`
          );
        } else if (body && typeof body === 'object' && body.message) {
          setServerError(`Server rejected totals: ${String(body.message)}`);
        } else if (body && typeof body === 'object' && body.error) {
          setServerError(`Server error (${err.status}): ${String(body.error)}`);
        } else {
          setServerError(err.message || 'Failed to record supplier invoice.');
        }
      } else {
        setServerError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-supplier-invoice-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'rgba(10, 10, 10, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 880,
          maxHeight: '92vh',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--color-surface)',
          }}
        >
          <div>
            <h2 id="new-supplier-invoice-title" style={{ fontSize: 'var(--text-xl)', margin: 0 }}>
              📥 Record Received Supplier Invoice
            </h2>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Commercial purchase receipt · Material price history &amp; stock movement updater
            </p>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
            style={{ padding: 'var(--space-1) var(--space-3)' }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form
          onSubmit={handleSubmit}
          style={{
            overflowY: 'auto',
            padding: 'var(--space-6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
          }}
        >
          {/* Server Error Alert */}
          {serverError && (
            <div className="alert alert-error">
              <span style={{ fontWeight: 600 }}>⚠️ Error:</span>
              <span>{serverError}</span>
            </div>
          )}

          {/* Supplier & Header Fields Card */}
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
              1. Supplier &amp; Invoice Header
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              {/* Supplier Party */}
              <div className="form-field">
                <label className="form-label" htmlFor="supplier-party-select">
                  Supplier Party *
                </label>
                {!isCustomParty ? (
                  <select
                    id="supplier-party-select"
                    className="select"
                    value={partyId}
                    disabled={submitting}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setIsCustomParty(true);
                      } else {
                        setPartyId(parseInt(e.target.value, 10));
                      }
                    }}
                  >
                    {SEEDED_SUPPLIERS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} (ID: {s.id})
                      </option>
                    ))}
                    <option value="custom">+ Other Party ID...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      type="number"
                      className="input"
                      placeholder="Enter Supplier ID"
                      value={customPartyId}
                      disabled={submitting}
                      onChange={(e) => setCustomPartyId(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setIsCustomParty(false)}
                      disabled={submitting}
                    >
                      Presets
                    </button>
                  </div>
                )}
              </div>

              {/* Invoice Number */}
              <div className="form-field">
                <label className="form-label" htmlFor="supplier-invoice-no">
                  Invoice Number *
                </label>
                <input
                  id="supplier-invoice-no"
                  type="text"
                  className="input"
                  placeholder="e.g. INV-2026-901"
                  value={invoiceNo}
                  disabled={submitting}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  required
                />
              </div>

              {/* Invoice Date */}
              <div className="form-field">
                <label className="form-label" htmlFor="supplier-invoice-date">
                  Invoice Date *
                </label>
                <input
                  id="supplier-invoice-date"
                  type="date"
                  className="input"
                  value={invoiceDate}
                  disabled={submitting}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  required
                />
              </div>

              {/* Due Date */}
              <div className="form-field">
                <label className="form-label" htmlFor="supplier-due-date">
                  Due Date *
                </label>
                <input
                  id="supplier-due-date"
                  type="date"
                  className="input"
                  value={dueDate}
                  disabled={submitting}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>

              {/* File Reference String */}
              <div className="form-field" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" htmlFor="supplier-file-url">
                  File Reference String (Plain Text, max 500 chars)
                </label>
                <input
                  id="supplier-file-url"
                  type="text"
                  className="input"
                  placeholder="e.g. S3://backups/invoices/2026/inv-901.pdf or scan-ref-901.pdf"
                  value={fileUrl}
                  maxLength={500}
                  disabled={submitting}
                  onChange={(e) => setFileUrl(e.target.value)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                  Plain document reference only. Executable URL schemes are rejected.
                </span>
              </div>

              {/* Record Stock Movement Checkbox */}
              <div
                className="form-field"
                style={{
                  gridColumn: 'span 2',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <input
                  id="record-stock-receipt-checkbox"
                  type="checkbox"
                  checked={recordStockReceipt}
                  disabled={submitting}
                  onChange={(e) => setRecordStockReceipt(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--color-primary)' }}
                />
                <label htmlFor="record-stock-receipt-checkbox" style={{ fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                  <strong>Record inventory intake immediately</strong> (adds items to physical stock ledger as receipts)
                </label>
              </div>
            </div>
          </div>

          {/* Dynamic Lines Card */}
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--text-base)', margin: 0, color: 'var(--color-primary)' }}>
                2. Dynamic Line Items ({lines.length})
              </h3>
              <button
                type="button"
                id="add-invoice-line-btn"
                className="btn btn-ghost"
                onClick={addLine}
                disabled={submitting}
                style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-3)' }}
              >
                + Add Line
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {lines.map((line, idx) => (
                <LineItemRow
                  key={line.id}
                  index={idx}
                  line={line}
                  catalog={catalog}
                  catalogLoading={catalogLoading}
                  disabled={submitting}
                  canRemove={lines.length > 1}
                  onUpdate={(updates) => updateLine(idx, updates)}
                  onRemove={() => removeLine(idx)}
                />
              ))}
            </div>
          </div>

          {/* Computed Totals Card (Server is final authority) */}
          <div
            className="card"
            style={{
              padding: 'var(--space-4) var(--space-5)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 'var(--space-4)',
                textAlign: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Computed Subtotal</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                  {formatMoney(computedTotals.subtotal, user?.role)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Computed VAT (15%)</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-warning)' }}>
                  {formatMoney(computedTotals.vat_amount, user?.role)}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>Total Reconciled</div>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--color-primary)' }}>
                  {formatMoney(computedTotals.total, user?.role)}
                </div>
              </div>
            </div>

            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', textAlign: 'center', marginTop: 'var(--space-3)' }}>
              * Totals are previewed client-side; the server is the single authoritative calculator and enforces exact decimal reconciliation.
            </div>
          </div>

          {/* Footer Submit Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              id="submit-supplier-invoice-btn"
              className="btn btn-primary"
              disabled={submitting}
              style={{ minWidth: 200 }}
            >
              {submitting ? (
                <>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  <span>Recording Invoice...</span>
                </>
              ) : (
                'Record Supplier Invoice'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sub-Component: Line Item Row with Debounced Material Search ───────────────

interface LineItemRowProps {
  index: number;
  line: FormLine;
  catalog: MaterialItem[];
  catalogLoading: boolean;
  disabled: boolean;
  canRemove: boolean;
  onUpdate: (updates: Partial<FormLine>) => void;
  onRemove: () => void;
}

function LineItemRow({
  index,
  line,
  catalog,
  catalogLoading,
  disabled,
  canRemove,
  onUpdate,
  onRemove,
}: LineItemRowProps) {
  const [itemSearch, setItemSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  // Debounce the item search text by 300ms
  const debouncedSearch = useDebounce(itemSearch, 300);

  // Filter catalog based on debounced search query
  const searchResults = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return catalog.slice(0, 8);
    return catalog
      .filter((it) => it.sku.toLowerCase().includes(q) || it.name.toLowerCase().includes(q))
      .slice(0, 10);
  }, [catalog, debouncedSearch]);

  // Compute local line total
  const lineTotal = useMemo(() => {
    const q = parseFloat(line.quantity) || 0;
    const p = parseFloat(line.unit_price) || 0;
    return (q * p).toFixed(2);
  }, [line.quantity, line.unit_price]);

  function handleSelectItem(item: MaterialItem) {
    onUpdate({
      item_id: item.id,
      item_sku: item.sku,
      item_name: item.name,
      description: line.description ? line.description : item.name,
      unit_id: item.unit_id,
      unit_code: item.unit_code,
    });
    setItemSearch('');
    setShowDropdown(false);
  }

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-primary)' }}>
          Line #{index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onRemove}
            disabled={disabled}
            style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', color: 'var(--color-danger)' }}
          >
            Remove
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 2fr 1fr 1fr 1fr',
          gap: 'var(--space-2)',
          alignItems: 'flex-start',
        }}
      >
        {/* Item Search & Selection with Debounce */}
        <div style={{ position: 'relative' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Material Item *</label>
          <input
            type="text"
            className="input"
            placeholder={line.item_sku ? `[${line.item_sku}] ${line.item_name}` : 'Type to search item...'}
            value={itemSearch}
            disabled={disabled}
            onChange={(e) => {
              setItemSearch(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}
          />

          {/* Selected Item Pill */}
          {line.item_id && !itemSearch && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
              Selected: <strong style={{ color: 'var(--color-primary)' }}>[{line.item_sku}]</strong> {line.item_name}
            </div>
          )}

          {/* Dropdown list */}
          {showDropdown && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 1200,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-md)',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {catalogLoading ? (
                <div style={{ padding: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Loading materials...
                </div>
              ) : searchResults.length === 0 ? (
                <div style={{ padding: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  No materials matching "{debouncedSearch}"
                </div>
              ) : (
                searchResults.map((it) => (
                  <div
                    key={it.id}
                    onClick={() => handleSelectItem(it)}
                    style={{
                      padding: 'var(--space-2)',
                      fontSize: 'var(--text-xs)',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      background: it.id === line.item_id ? 'var(--color-primary-glow)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-2)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        it.id === line.item_id ? 'var(--color-primary-glow)' : 'transparent';
                    }}
                  >
                    <strong>[{it.sku}]</strong> {it.name} ({it.unit_code})
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Line Description */}
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Description *</label>
          <input
            type="text"
            className="input"
            placeholder="Line description"
            value={line.description}
            disabled={disabled}
            onChange={(e) => onUpdate({ description: e.target.value })}
            required
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}
          />
        </div>

        {/* Quantity */}
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Qty ({line.unit_code}) *</label>
          <input
            type="number"
            step="any"
            min="0.001"
            className="input"
            value={line.quantity}
            disabled={disabled}
            onChange={(e) => onUpdate({ quantity: e.target.value })}
            required
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2)', textAlign: 'right' }}
          />
        </div>

        {/* Unit Price (up to 4 decimal places) */}
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Unit Price *</label>
          <input
            type="number"
            step="any"
            min="0"
            className="input"
            placeholder="0.0000"
            value={line.unit_price}
            disabled={disabled}
            onChange={(e) => onUpdate({ unit_price: e.target.value })}
            required
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2)', textAlign: 'right' }}
          />
        </div>

        {/* Line Total */}
        <div>
          <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Total (SAR)</label>
          <div
            style={{
              padding: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              color: 'var(--color-primary)',
            }}
          >
            {lineTotal}
          </div>
        </div>
      </div>
    </div>
  );
}
