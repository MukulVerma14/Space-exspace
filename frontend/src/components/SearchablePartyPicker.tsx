/**
 * SearchablePartyPicker — Searchable dropdown picker for customer and supplier parties.
 *
 * Requirements (F-S4):
 * - Replaces hardcoded party dropdowns in NewSupplierInvoiceModal and NewCustomerInvoiceModal.
 * - Queries minimal admin-only GET /api/parties?role=customer or ?role=supplier.
 * - Supports keyboard navigation, live search filtering by name/vat_no/contact,
 *   and clear feedback when items are loading or unavailable.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PartyItem, fetchParties } from '../data/invoicesSource';

interface SearchablePartyPickerProps {
  role: 'customer' | 'supplier';
  value: number | null;
  onChange: (party: PartyItem | null) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  placeholder?: string;
}

export default function SearchablePartyPicker({
  role,
  value,
  onChange,
  disabled = false,
  required = false,
  id,
  placeholder,
}: SearchablePartyPickerProps) {
  const [parties, setParties] = useState<PartyItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch parties for given role
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchParties(role)
      .then((data) => {
        if (!active) return;
        setParties(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load parties');
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [role]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Selected party object
  const selectedParty = useMemo(() => {
    if (!value) return null;
    return parties.find((p) => p.id === value) || null;
  }, [parties, value]);

  // Filtered parties based on search input
  const filteredParties = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return parties;
    return parties.filter((p) => {
      const nameMatch = p.name.toLowerCase().includes(q);
      const contactMatch = p.contact_person?.toLowerCase().includes(q);
      const vatMatch = p.vat_no?.toLowerCase().includes(q);
      const emailMatch = p.email?.toLowerCase().includes(q);
      return nameMatch || contactMatch || vatMatch || emailMatch;
    });
  }, [parties, searchTerm]);

  const defaultPlaceholder =
    placeholder || (role === 'supplier' ? 'Select or search a supplier…' : 'Select or search a customer…');

  const handleSelect = (party: PartyItem) => {
    onChange(party);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setSearchTerm('');
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%' }}
      className="searchable-party-picker"
    >
      {/* Trigger Button */}
      <button
        type="button"
        id={id}
        disabled={disabled || loading}
        onClick={() => {
          if (!disabled && !loading) {
            setIsOpen((prev) => !prev);
            setTimeout(() => searchInputRef.current?.focus(), 50);
          }
        }}
        className="form-control"
        style={{
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: disabled ? 'var(--color-bg-muted, #f3f4f6)' : 'var(--color-surface, #ffffff)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '0.5rem 0.75rem',
          border: '1px solid var(--color-border, #d1d5db)',
          borderRadius: 'var(--radius-md, 6px)',
          minHeight: '38px',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selectedParty ? 'var(--color-text, #111827)' : 'var(--color-text-muted, #6b7280)',
          }}
        >
          {loading ? (
            'Loading parties…'
          ) : selectedParty ? (
            <span>
              <strong>{selectedParty.name}</strong>
              {selectedParty.vat_no ? ` (VAT: ${selectedParty.vat_no})` : ''}
            </span>
          ) : (
            defaultPlaceholder
          )}
        </span>

        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginLeft: '0.5rem' }}>
          {selectedParty && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleClear(e as unknown as React.MouseEvent);
                }
              }}
              style={{
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                padding: '0 4px',
                fontWeight: 'bold',
              }}
              title="Clear selection"
            >
              ✕
            </span>
          )}
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            {isOpen ? '▲' : '▼'}
          </span>
        </span>
      </button>

      {/* Hidden input for form validation if required */}
      {required && (
        <input
          type="text"
          value={value ? String(value) : ''}
          required
          onChange={() => {}}
          style={{
            position: 'absolute',
            opacity: 0,
            pointerEvents: 'none',
            height: 0,
            width: 0,
            bottom: 0,
          }}
          tabIndex={-1}
        />
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="card"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 1050,
            maxHeight: '260px',
            overflowY: 'auto',
            padding: '0.5rem',
            boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0, 0, 0, 0.1))',
            border: '1px solid var(--color-border, #d1d5db)',
            backgroundColor: 'var(--color-surface, #ffffff)',
          }}
        >
          {/* Search Filter Box */}
          <div style={{ marginBottom: '0.5rem' }}>
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Search ${role} by name, VAT or contact…`}
              className="form-control"
              style={{ width: '100%', fontSize: 'var(--text-xs, 0.8125rem)', padding: '0.4rem 0.6rem' }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {error && (
            <div style={{ color: 'var(--color-danger, #ef4444)', fontSize: 'var(--text-xs)', padding: '0.5rem' }}>
              {error}
            </div>
          )}

          {filteredParties.length === 0 && !error && (
            <div
              style={{
                color: 'var(--color-text-muted, #6b7280)',
                fontSize: 'var(--text-xs)',
                padding: '0.75rem',
                textAlign: 'center',
              }}
            >
              No {role}s found matching &ldquo;{searchTerm}&rdquo;
            </div>
          )}

          {filteredParties.map((p) => {
            const isSelected = p.id === value;
            return (
              <div
                key={p.id}
                role="option"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => handleSelect(p)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSelect(p);
                }}
                style={{
                  padding: '0.5rem 0.75rem',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm, 4px)',
                  backgroundColor: isSelected ? 'var(--color-primary-light, #e0f2fe)' : 'transparent',
                  color: isSelected ? 'var(--color-primary-dark, #0369a1)' : 'var(--color-text, #111827)',
                  fontSize: 'var(--text-sm, 0.875rem)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover, #f3f4f6)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div>
                  <div style={{ fontWeight: isSelected ? 600 : 500 }}>{p.name}</div>
                  <div style={{ fontSize: 'var(--text-xs, 0.75rem)', color: 'var(--color-text-muted, #6b7280)' }}>
                    {p.vat_no ? `VAT: ${p.vat_no}` : ''}
                    {p.contact_person ? ` • Contact: ${p.contact_person}` : ''}
                  </div>
                </div>
                {isSelected && <span style={{ color: 'var(--color-primary, #0284c7)' }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
