/**
 * NewCustomerInvoiceModal — Form modal for recording issued customer billing invoices.
 *
 * Requirements (F-I4):
 * - Store-only customer invoice workflow (no generation, no ZATCA XML).
 * - Dynamic lines with debounced item search or custom service descriptions.
 * - Customer party selector (with seeded customer presets and custom party ID).
 * - Optional associated rental contract ID (rental_id).
 * - Real-time computed totals with server as final authority.
 * - Clear server error formatting (400 validation, foreign rental, 409 duplicate).
 * - Disabled while in flight.
 * - Plain text file references only.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../hooks/useDebounce';
import { MaterialItem, loadMaterials } from '../data/materialsSource';
import {
  createCustomerInvoice,
  computeInvoiceTotals,
  formatMoney,
  CreateCustomerInvoicePayload,
} from '../data/invoicesSource';
import { ApiRequestError } from '../api/client';

interface NewCustomerInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newInvoiceId: number, invoiceNo: string) => void;
}

interface CustomerFormLine {
  id: string;
  item_id: number | null;
  item_sku: string;
  item_name: string;
  description: string;
  quantity: string;
  unit_id: number;
  unit_code: string;
  unit_price: string;
}

const SEEDED_CUSTOMERS = [
  { id: 4, name: 'Apex Infrastructure Partners' },
  { id: 5, name: 'Gulf Petrochemical Services Ltd' },
  { id: 6, name: 'Al-Mansoor Contracting Est.' },
];

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function getFutureDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function createEmptyCustomerLine(): CustomerFormLine {
  return {
    id: Math.random().toString(36).substring(2, 9),
    item_id: null,
    item_sku: '',
    item_name: '',
    description: '',
    quantity: '1',
    unit_id: 1, // Standard pieces / each unit default
    unit_code: 'pcs',
    unit_price: '',
  };
}

export default function NewCustomerInvoiceModal({
  isOpen,
  onClose,
  onSuccess,
}: NewCustomerInvoiceModalProps) {
  const { user } = useAuth();

  // Material catalog for optional line item association
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  // Form Header State
  const [partyId, setPartyId] = useState<number>(4);
  const [customPartyId, setCustomPartyId] = useState<string>('');
  const [isCustomParty, setIsCustomParty] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [rentalId, setRentalId] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState(getTodayString());
  const [dueDate, setDueDate] = useState(getFutureDateString(30));
  const [notes, setNotes] = useState('');
  const [fileUrl, setFileUrl] = useState('');

  // Dynamic Lines State
  const [lines, setLines] = useState<CustomerFormLine[]>([createEmptyCustomerLine()]);

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

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setPartyId(4);
      setCustomPartyId('');
      setIsCustomParty(false);
      setInvoiceNo('');
      setRentalId('');
      setInvoiceDate(getTodayString());
      setDueDate(getFutureDateString(30));
      setNotes('');
      setFileUrl('');
      setLines([createEmptyCustomerLine()]);
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
  function updateLine(index: number, updates: Partial<CustomerFormLine>) {
    setLines((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...updates };
      return copy;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, createEmptyCustomerLine()]);
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
      setServerError('Please select or specify a valid customer party ID.');
      return;
    }

    if (!invoiceNo.trim()) {
      setServerError('Invoice number is required.');
      return;
    }

    const parsedRentalId = rentalId.trim() ? parseInt(rentalId.trim(), 10) : null;
    if (rentalId.trim() && (isNaN(parsedRentalId!) || parsedRentalId! <= 0)) {
      setServerError('Rental ID must be a positive integer if provided.');
      return;
    }

    // Client-side validation of line items
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.description.trim()) {
        setServerError(`Line #${i + 1}: Line description is required.`);
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
    }

    // Prepare payload
    const payload: CreateCustomerInvoicePayload = {
      party_id: finalPartyId,
      invoice_no: invoiceNo.trim(),
      rental_id: parsedRentalId,
      invoice_date: invoiceDate,
      due_date: dueDate,
      subtotal: computedTotals.subtotal,
      vat_amount: computedTotals.vat_amount,
      total: computedTotals.total,
      notes: notes.trim() ? notes.trim() : null,
      file_url: fileUrl.trim() ? fileUrl.trim() : null,
      lines: lines.map((l) => ({
        description: l.description.trim(),
        item_id: l.item_id || null,
        quantity: parseFloat(l.quantity),
        unit_id: l.unit_id,
        unit_price: parseFloat(l.unit_price),
      })),
    };

    setSubmitting(true);

    try {
      const res = await createCustomerInvoice(payload, user?.role);
      setSubmitting(false);
      onSuccess(res.invoice_id, res.invoice_no);
    } catch (err: unknown) {
      setSubmitting(false);
      if (err instanceof ApiRequestError) {
        const body = err.body as Record<string, unknown> | null;
        if (err.status === 409) {
          setServerError(
            `Duplicate Invoice (409): Customer invoice '${invoiceNo}' already exists for this customer.`
          );
        } else if (body && typeof body === 'object' && body.error === 'Foreign rental') {
          setServerError(`Foreign Rental (400): ${String(body.message)}`);
        } else if (body && typeof body === 'object' && body.message) {
          setServerError(`Server rejected totals: ${String(body.message)}`);
        } else if (body && typeof body === 'object' && body.error) {
          setServerError(`Server error (${err.status}): ${String(body.error)}`);
        } else {
          setServerError(err.message || 'Failed to record customer invoice.');
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
      aria-labelledby="new-customer-invoice-title"
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
            <h2 id="new-customer-invoice-title" style={{ fontSize: 'var(--text-xl)', margin: 0 }}>
              📤 Record Issued Customer Invoice
            </h2>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Commercial billing record · Equipment rental and service invoice (Store-only workflow)
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

          {/* Customer & Header Fields Card */}
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <h3 style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-3)', color: 'var(--color-info)' }}>
              1. Customer &amp; Billing Header
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-4)',
              }}
            >
              {/* Customer Party */}
              <div className="form-field">
                <label className="form-label" htmlFor="customer-party-select">
                  Customer Party *
                </label>
                {!isCustomParty ? (
                  <select
                    id="customer-party-select"
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
                    {SEEDED_CUSTOMERS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (ID: {c.id})
                      </option>
                    ))}
                    <option value="custom">+ Other Customer ID...</option>
                  </select>
                ) : (
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      type="number"
                      className="input"
                      placeholder="Enter Customer ID"
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
                <label className="form-label" htmlFor="customer-invoice-no">
                  Invoice Number *
                </label>
                <input
                  id="customer-invoice-no"
                  type="text"
                  className="input"
                  placeholder="e.g. INV-CUST-2026-001"
                  value={invoiceNo}
                  disabled={submitting}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  required
                />
              </div>

              {/* Optional Rental Contract ID */}
              <div className="form-field">
                <label className="form-label" htmlFor="customer-rental-id">
                  Rental Contract ID (Optional)
                </label>
                <input
                  id="customer-rental-id"
                  type="number"
                  className="input"
                  placeholder="e.g. 1"
                  value={rentalId}
                  disabled={submitting}
                  onChange={(e) => setRentalId(e.target.value)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                  If specified, must belong to this customer party.
                </span>
              </div>

              {/* Invoice Date */}
              <div className="form-field">
                <label className="form-label" htmlFor="customer-invoice-date">
                  Invoice Date *
                </label>
                <input
                  id="customer-invoice-date"
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
                <label className="form-label" htmlFor="customer-due-date">
                  Due Date *
                </label>
                <input
                  id="customer-due-date"
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
                <label className="form-label" htmlFor="customer-file-url">
                  File Reference String (Plain Text, max 500 chars)
                </label>
                <input
                  id="customer-file-url"
                  type="text"
                  className="input"
                  placeholder="e.g. S3://billing/2026/cust-inv-001.pdf or scan-ref-001.pdf"
                  value={fileUrl}
                  maxLength={500}
                  disabled={submitting}
                  onChange={(e) => setFileUrl(e.target.value)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                  Plain document reference only. Executable URL schemes are rejected.
                </span>
              </div>

              {/* Notes */}
              <div className="form-field" style={{ gridColumn: 'span 2' }}>
                <label className="form-label" htmlFor="customer-notes">
                  Invoice Notes (Optional)
                </label>
                <input
                  id="customer-notes"
                  type="text"
                  className="input"
                  placeholder="Terms, payment instructions, or site dispatch notes"
                  value={notes}
                  disabled={submitting}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Dynamic Lines Card */}
          <div className="card" style={{ padding: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--text-base)', margin: 0, color: 'var(--color-info)' }}>
                2. Dynamic Billing Lines ({lines.length})
              </h3>
              <button
                type="button"
                id="add-customer-invoice-line-btn"
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
                <CustomerLineRow
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

          {/* Computed Totals Card */}
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
              * Totals are previewed client-side; the server is the single authoritative calculator and enforces exact decimal reconciliation. Issued customer invoices do NOT create inventory movements.
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
              id="submit-customer-invoice-btn"
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
                'Record Customer Invoice'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sub-Component: Customer Line Item Row ─────────────────────────────────────

interface CustomerLineRowProps {
  index: number;
  line: CustomerFormLine;
  catalog: MaterialItem[];
  catalogLoading: boolean;
  disabled: boolean;
  canRemove: boolean;
  onUpdate: (updates: Partial<CustomerFormLine>) => void;
  onRemove: () => void;
}

function CustomerLineRow({
  index,
  line,
  catalog,
  catalogLoading,
  disabled,
  canRemove,
  onUpdate,
  onRemove,
}: CustomerLineRowProps) {
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
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-info)' }}>
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
        {/* Optional Item Picker from Catalog (or custom service) */}
        <div style={{ position: 'relative' }}>
          <label style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>Material SKU (Optional)</label>
          <input
            type="text"
            className="input"
            placeholder={line.item_sku ? `[${line.item_sku}] ${line.item_name}` : 'Search SKU or leave empty'}
            value={itemSearch}
            disabled={disabled}
            onChange={(e) => {
              setItemSearch(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}
          />

          {line.item_id && !itemSearch && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
              <span>Linked: <strong>[{line.item_sku}]</strong></span>
              <button
                type="button"
                onClick={() => onUpdate({ item_id: null, item_sku: '', item_name: '' })}
                style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '0.65rem' }}
              >
                Clear
              </button>
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
            placeholder="e.g. Monthly crane rental fee"
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
