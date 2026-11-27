/**
 * NewRentalModal — Admin modal for creating a new rental agreement or quotation.
 *
 * Requirements (R2):
 * - Searchable customer picker (GET /api/parties?role=customer)
 * - Available-equipment picker (GET /api/equipment?status=available)
 * - Rate card prefilling (GET /api/rates) for selected model & unit (daily default)
 * - Editable applied rate with optional discount note
 * - Multiple equipment item addition support
 * - Delivery site picker (locations)
 * - Start date and expected end date validation (expected_end >= start_date)
 * - Agreement type selection: 'confirmed' (default) vs 'quotation'
 * - Clean conflict error feedback (409)
 */

import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, ApiRequestError } from '../api/client';
import { fetchLocations, AppLocation, MockEquipment } from '../data/equipmentSource';
import {
  createRental,
  fetchStandardRates,
  StandardRateCardItem,
  RentalRateUnit,
} from '../data/rentalsSource';
import SearchablePartyPicker from './SearchablePartyPicker';
import { PartyItem } from '../data/invoicesSource';

interface NewRentalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newRentalId: number, status: string) => void;
}

interface RentalFormItem {
  id: string; // client temporary id
  equipment_id: number | null;
  asset_code: string;
  model_id: number | null;
  make: string;
  model: string;
  type_name: string;
  rate_unit: RentalRateUnit;
  applied_rate: string;
  discount_note: string;
  standard_rate: string | null;
}

function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

function getFutureDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function createEmptyRentalItem(): RentalFormItem {
  return {
    id: Math.random().toString(36).substring(2, 9),
    equipment_id: null,
    asset_code: '',
    model_id: null,
    make: '',
    model: '',
    type_name: '',
    rate_unit: 'daily',
    applied_rate: '',
    discount_note: '',
    standard_rate: null,
  };
}

export default function NewRentalModal({
  isOpen,
  onClose,
  onSuccess,
}: NewRentalModalProps) {
  const { user } = useAuth();

  // Reference Catalogs
  const [locations, setLocations] = useState<AppLocation[]>([]);
  const [availableEquipment, setAvailableEquipment] = useState<MockEquipment[]>([]);
  const [rateCards, setRateCards] = useState<StandardRateCardItem[]>([]);
  const [catalogsLoading, setCatalogsLoading] = useState(false);

  // Form Header State
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [siteId, setSiteId] = useState<number | null>(null);
  const [status, setStatus] = useState<'confirmed' | 'quotation'>('confirmed');
  const [startDate, setStartDate] = useState(getTodayString());
  const [expectedEnd, setExpectedEnd] = useState(getFutureDateString(7));

  // Dynamic Line Items
  const [items, setItems] = useState<RentalFormItem[]>([createEmptyRentalItem()]);

  // Submission & Feedback State
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Load catalogs on modal open
  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    setCatalogsLoading(true);
    setServerError(null);

    Promise.all([
      fetchLocations(user?.id),
      api.get<{ items: MockEquipment[] }>('/api/equipment?status=available&limit=100').catch(() => ({ items: [] })),
      fetchStandardRates().catch(() => []),
    ])
      .then(([locs, eqRes, rates]) => {
        if (!active) return;
        setLocations(locs);
        setAvailableEquipment(eqRes.items || []);
        setRateCards(rates);

        // Pre-select first client site or default location if none selected
        if (locs.length > 0) {
          const clientSite = locs.find((l) => l.kind === 'client_site');
          setSiteId(clientSite ? clientSite.id : locs[0].id);
        }
        setCatalogsLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setServerError(err instanceof Error ? err.message : 'Failed to load catalogs');
        setCatalogsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, user?.id]);

  // Helper to find standard rate for an equipment item and unit
  const lookupStandardRate = (modelId: number | null, unit: RentalRateUnit): string | null => {
    if (!modelId) return null;
    const match = rateCards.find(
      (r) => Number(r.model_id) === Number(modelId) && r.unit === unit
    );
    return match ? String(match.amount) : null;
  };

  // Line item field update
  const updateItem = (id: string, updates: Partial<RentalFormItem>) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...updates };

        // If equipment was changed, auto-lookup model and standard rate
        if (updates.equipment_id !== undefined && updates.equipment_id !== item.equipment_id) {
          const selectedEq = availableEquipment.find((e) => e.id === updates.equipment_id);
          if (selectedEq) {
            updated.asset_code = selectedEq.asset_code;
            updated.make = selectedEq.make;
            updated.model = selectedEq.model;
            updated.type_name = selectedEq.type_name;
            // MockEquipment may or may not have model_id directly; search rate cards or fallback
            const foundRate = rateCards.find(
              (r) => r.make.toLowerCase() === selectedEq.make.toLowerCase() &&
                     r.model.toLowerCase() === selectedEq.model.toLowerCase()
            );
            const modelId = foundRate ? foundRate.model_id : null;
            updated.model_id = modelId;

            const std = lookupStandardRate(modelId, updated.rate_unit);
            updated.standard_rate = std;
            if (std !== null) {
              updated.applied_rate = std;
            }
          } else {
            updated.equipment_id = null;
            updated.asset_code = '';
            updated.model_id = null;
            updated.make = '';
            updated.model = '';
            updated.type_name = '';
            updated.standard_rate = null;
            updated.applied_rate = '';
          }
        }

        // If rate_unit was changed, re-lookup standard rate
        if (updates.rate_unit !== undefined && updates.rate_unit !== item.rate_unit) {
          const std = lookupStandardRate(updated.model_id, updates.rate_unit);
          updated.standard_rate = std;
          if (std !== null) {
            updated.applied_rate = std;
          }
        }

        return updated;
      })
    );
  };

  // Add equipment line
  const handleAddItem = () => {
    setItems((prev) => [...prev, createEmptyRentalItem()]);
  };

  // Remove equipment line
  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Equipment already selected in other lines
  const selectedEquipmentIds = useMemo(() => {
    return new Set(items.map((i) => i.equipment_id).filter((id): id is number => id !== null));
  }, [items]);

  // Form Validation
  const validationError = useMemo(() => {
    if (!customerId) return 'Please select a customer';
    if (!siteId) return 'Please select a delivery site';
    if (!startDate) return 'Start date is required';
    if (!expectedEnd) return 'Expected end date is required';
    if (expectedEnd < startDate) return 'Expected end date cannot be earlier than start date';
    if (items.length === 0) return 'At least one equipment item is required';

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      if (!it.equipment_id) return `Please select equipment for line #${idx + 1}`;
      const numRate = parseFloat(it.applied_rate);
      if (isNaN(numRate) || numRate < 0) {
        return `Please enter a valid rate (>= 0) for equipment ${it.asset_code || `#${idx + 1}`}`;
      }
    }

    return null;
  }, [customerId, siteId, startDate, expectedEnd, items]);

  // Handle Submit
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (validationError || submitting || !customerId || !siteId) return;

    setSubmitting(true);
    setServerError(null);

    const payload = {
      customer_id: customerId,
      site_id: siteId,
      start_date: startDate,
      expected_end: expectedEnd,
      status,
      items: items.map((it) => ({
        equipment_id: it.equipment_id!,
        applied_rate: parseFloat(it.applied_rate) || 0,
        rate_unit: it.rate_unit,
        discount_note: it.discount_note.trim() ? it.discount_note.trim() : undefined,
      })),
    };

    try {
      const res = await createRental(payload);
      setSubmitting(false);
      onSuccess(res.rental_id, res.status);
      onClose();
    } catch (err: unknown) {
      setSubmitting(false);
      if (err instanceof ApiRequestError) {
        if (err.status === 409) {
          setServerError(`Availability Conflict: ${err.message}`);
          return;
        }
        setServerError(`Error (${err.status}): ${err.message}`);
        return;
      }
      setServerError(err instanceof Error ? err.message : 'Failed to create rental agreement');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-rental-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(10, 10, 10, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 820,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: 'var(--space-5) var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--color-surface)',
          }}
        >
          <div>
            <h2 id="new-rental-modal-title" style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
              New Rental Agreement
            </h2>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Create an equipment rental quotation or confirmed contract with agreed commercial rates.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close dialog"
            style={{ padding: 'var(--space-2)' }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <form
          id="new-rental-form"
          onSubmit={handleSubmit}
          style={{
            padding: 'var(--space-6)',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
          }}
        >
          {/* Server Error Alert */}
          {serverError && (
            <div className="alert alert-error">
              <span>{serverError}</span>
            </div>
          )}

          {/* Catalogs Loading */}
          {catalogsLoading && (
            <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)' }}>
              <div className="spinner spinner-sm" style={{ margin: '0 auto var(--space-2)' }} />
              Loading catalogs and rate cards…
            </div>
          )}

          {/* Section: Agreement Details */}
          <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--color-surface)' }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-3)', color: 'var(--color-primary)' }}>
              1. Agreement Header
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
              {/* Customer Picker */}
              <div className="form-field">
                <label htmlFor="rental-customer-picker" className="form-label">
                  Customer <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <SearchablePartyPicker
                  id="rental-customer-picker"
                  role="customer"
                  value={customerId}
                  onChange={(party: PartyItem | null) => setCustomerId(party ? party.id : null)}
                  disabled={submitting}
                  required
                />
              </div>

              {/* Delivery Site Picker */}
              <div className="form-field">
                <label htmlFor="rental-site-picker" className="form-label">
                  Delivery Site <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <select
                  id="rental-site-picker"
                  className="input"
                  value={siteId ?? ''}
                  onChange={(e) => setSiteId(Number(e.target.value) || null)}
                  disabled={submitting}
                  required
                >
                  <option value="" disabled>Select delivery site…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} {loc.kind === 'client_site' ? '(Client Site)' : `(${loc.kind})`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Agreement Initial Status */}
              <div className="form-field">
                <label htmlFor="rental-status-select" className="form-label">
                  Agreement Status <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <select
                  id="rental-status-select"
                  className="input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'confirmed' | 'quotation')}
                  disabled={submitting}
                >
                  <option value="confirmed">Confirmed (Allocates equipment)</option>
                  <option value="quotation">Quotation (Draft / Pending client approval)</option>
                </select>
              </div>

              {/* Start Date */}
              <div className="form-field">
                <label htmlFor="rental-start-date" className="form-label">
                  Start Date <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="rental-start-date"
                  type="date"
                  className="input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              {/* Expected End Date */}
              <div className="form-field">
                <label htmlFor="rental-expected-end" className="form-label">
                  Expected End Date <span style={{ color: 'var(--color-danger)' }}>*</span>
                </label>
                <input
                  id="rental-expected-end"
                  type="date"
                  className="input"
                  value={expectedEnd}
                  onChange={(e) => setExpectedEnd(e.target.value)}
                  min={startDate}
                  disabled={submitting}
                  required
                />
              </div>
            </div>
          </div>

          {/* Section: Equipment Line Items */}
          <div className="card" style={{ padding: 'var(--space-4)', background: 'var(--color-surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-primary)' }}>
                2. Equipment Items ({items.length})
              </h3>
              <button
                type="button"
                id="add-equipment-item-btn"
                className="btn btn-secondary"
                style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)' }}
                onClick={handleAddItem}
                disabled={submitting}
              >
                + Add Equipment
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {items.map((item, index) => {
                const isDiscounted =
                  item.standard_rate !== null &&
                  parseFloat(item.applied_rate) < parseFloat(item.standard_rate);

                return (
                  <div
                    key={item.id}
                    className="card"
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                        Line #{index + 1}
                      </span>
                      {items.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '2px 8px', color: 'var(--color-danger)', fontSize: 'var(--text-xs)' }}
                          onClick={() => handleRemoveItem(item.id)}
                          disabled={submitting}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
                      {/* Available Equipment Dropdown */}
                      <div className="form-field" style={{ gridColumn: 'span 2' }}>
                        <label htmlFor={`eq-select-${item.id}`} className="form-label">
                          Available Equipment <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <select
                          id={`eq-select-${item.id}`}
                          className="input"
                          value={item.equipment_id ?? ''}
                          onChange={(e) => updateItem(item.id, { equipment_id: Number(e.target.value) || null })}
                          disabled={submitting}
                          required
                        >
                          <option value="" disabled>Select available machine…</option>
                          {availableEquipment.map((eq) => {
                            const isChosenElsewhere =
                              selectedEquipmentIds.has(eq.id) && eq.id !== item.equipment_id;
                            return (
                              <option key={eq.id} value={eq.id} disabled={isChosenElsewhere}>
                                {eq.asset_code} — {eq.make} {eq.model} ({eq.type_name})
                                {isChosenElsewhere ? ' [Already Added]' : ''}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      {/* Billing Rate Unit */}
                      <div className="form-field">
                        <label htmlFor={`unit-select-${item.id}`} className="form-label">
                          Billing Unit <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <select
                          id={`unit-select-${item.id}`}
                          className="input"
                          value={item.rate_unit}
                          onChange={(e) => updateItem(item.id, { rate_unit: e.target.value as RentalRateUnit })}
                          disabled={submitting}
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="hourly">Hourly</option>
                        </select>
                      </div>

                      {/* Applied Rate (Prefilled from standard rate card) */}
                      <div className="form-field">
                        <label htmlFor={`rate-input-${item.id}`} className="form-label">
                          Applied Rate (SAR) <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <div style={{ position: 'relative' }}>
                          <input
                            id={`rate-input-${item.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            className="input"
                            value={item.applied_rate}
                            onChange={(e) => updateItem(item.id, { applied_rate: e.target.value })}
                            disabled={submitting}
                            required
                          />
                        </div>
                        {item.standard_rate !== null && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 2 }}>
                            Standard card: {parseFloat(item.standard_rate).toLocaleString('en-US', { minimumFractionDigits: 2 })} SAR / {item.rate_unit}
                            {isDiscounted && (
                              <span style={{ color: 'var(--color-success)', fontWeight: 600, marginLeft: 4 }}>
                                (Discount applied)
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Discount / Rate Adjustment Note */}
                      <div className="form-field" style={{ gridColumn: 'span 2' }}>
                        <label htmlFor={`note-input-${item.id}`} className="form-label">
                          Discount / Rate Note
                        </label>
                        <input
                          id={`note-input-${item.id}`}
                          type="text"
                          placeholder={isDiscounted ? 'e.g. 10% volume discount approved' : 'Optional rate adjustment note…'}
                          className="input"
                          value={item.discount_note}
                          onChange={(e) => updateItem(item.id, { discount_note: e.target.value })}
                          disabled={submitting}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Validation Notice */}
          {validationError && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)', padding: 'var(--space-2)' }}>
              ⚠️ {validationError}
            </div>
          )}
        </form>

        {/* Modal Footer */}
        <div
          style={{
            padding: 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 'var(--space-3)',
            background: 'var(--color-surface)',
          }}
        >
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
            form="new-rental-form"
            id="submit-new-rental-btn"
            className="btn btn-primary"
            disabled={Boolean(validationError) || submitting || catalogsLoading}
          >
            {submitting ? 'Creating Agreement…' : status === 'quotation' ? 'Create Quotation' : 'Confirm & Create Rental'}
          </button>
        </div>
      </div>
    </div>
  );
}
