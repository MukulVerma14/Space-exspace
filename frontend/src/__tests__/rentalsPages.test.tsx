/**
 * Rentals Pages UI & Role Privacy Integration Tests
 *
 * Requirements (R2):
 * - Admin Rentals page:
 *   - Renders rentals list with filters & metrics
 *   - Detail drawer renders commercial rates and customer contact info
 *   - Renders action triggers (confirm quotation, dispatch, cancel)
 * - Staff Rentals page:
 *   - Renders active rentals only (confirmed & picked_up)
 *   - STRICT PRIVACY: Zero money or currency rendered in DOM (no SAR, no applied_rate)
 *   - STRICT PRIVACY: Zero customer contact info rendered in DOM (no phone, email, contact person)
 *   - Renders dispatch / pick up action
 * - Offline Resiliency:
 *   - Snapshot banner rendered when cached data is active
 *   - "Internet connection required" rendered when offline and no cache
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AdminRentalsPage from '../pages/admin/AdminRentalsPage';
import StaffRentalsPage from '../pages/staff/StaffRentalsPage';
import * as AuthContextModule from '../context/AuthContext';
import * as rentalsSourceModule from '../data/rentalsSource';

// Mock sub-components that rely on browser globals or canvas
vi.mock('../components/SearchablePartyPicker', () => ({
  default: () => React.createElement('div', { 'data-testid': 'searchable-party-picker' }),
}));

describe('Rentals Pages — Admin & Staff UI, Offline & Privacy Policy', () => {
  const mockAdminRentals: rentalsSourceModule.RentalListItem[] = [
    {
      id: 101,
      customer_id: 1,
      customer_name: 'Saudi Aramco Base',
      site_id: 10,
      site_name: 'Ras Tanura Refinery Unit 4',
      status: 'confirmed',
      start_date: '2026-11-01',
      expected_end: '2026-11-30',
      created_at: '2026-10-25T08:00:00Z',
      total_items: 2,
      active_items: 2,
    },
    {
      id: 102,
      customer_id: 2,
      customer_name: 'SABIC Petrochem',
      site_id: 11,
      site_name: 'Jubail Industrial Plant #2',
      status: 'quotation',
      start_date: '2026-11-15',
      expected_end: '2026-12-15',
      created_at: '2026-10-26T10:00:00Z',
      total_items: 1,
      active_items: 1,
    },
    {
      id: 103,
      customer_id: 1,
      customer_name: 'Saudi Aramco Base',
      site_id: 10,
      site_name: 'Ras Tanura Refinery Unit 4',
      status: 'picked_up',
      start_date: '2026-10-10',
      expected_end: '2026-10-31',
      created_at: '2026-10-05T08:00:00Z',
      total_items: 1,
      active_items: 1,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('AdminRentalsPage', () => {
    it('renders admin rentals list with metric counters and action triggers', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: {
          id: 1,
          name: 'Sarah Chen (Admin)',
          email: 'admin@space-exs.com',
          role: 'admin',
        },
        status: 'authenticated',
        login: vi.fn(),
        logout: vi.fn(),
      });

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin/rentals']}>
          <AdminRentalsPage
            initialRentals={mockAdminRentals}
            initialLoading={false}
            initialDataSource="live"
          />
        </MemoryRouter>
      );

      // Verify page titles and admin actions
      expect(html).toContain('Rentals Management');
      expect(html).toContain('+ New Rental');
      expect(html).toContain('Total Agreements');
      expect(html).toContain('Quotations');
      expect(html).toContain('Confirmed (Awaiting Dispatch)');
      expect(html).toContain('Picked Up / On Site');
      expect(html).toContain('Returned / Completed');

      // Verify status filter tabs
      expect(html).toContain('All');
      expect(html).toContain('Quotations');
      expect(html).toContain('Confirmed');
      expect(html).toContain('Picked Up');
      expect(html).toContain('Returned');
      expect(html).toContain('Cancelled');

      // Verify search input
      expect(html).toContain('placeholder="Search customer, site, or #ID…"');

      // Verify table headers
      expect(html).toContain('Rental');
      expect(html).toContain('Customer');
      expect(html).toContain('Delivery Site');
      expect(html).toContain('Status');
      expect(html).toContain('Start Date');
      expect(html).toContain('Expected End');
      expect(html).toContain('Items');

      // Verify rows
      expect(html).toContain('#101');
      expect(html).toContain('#102');
      expect(html).toContain('#103');
      expect(html).toContain('Saudi Aramco Base');
      expect(html).toContain('SABIC Petrochem');
      expect(html).toContain('Ras Tanura Refinery Unit 4');
      expect(html).toContain('Jubail Industrial Plant #2');
    });

    it('renders snapshot banner when admin page is loaded from cached snapshot', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: {
          id: 1,
          name: 'Sarah Chen (Admin)',
          email: 'admin@space-exs.com',
          role: 'admin',
        },
        status: 'authenticated',
        login: vi.fn(),
        logout: vi.fn(),
      });

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin/rentals']}>
          <AdminRentalsPage
            initialRentals={mockAdminRentals}
            initialLoading={false}
            initialDataSource="snapshot"
            initialSavedAt="2026-10-30T10:00:00Z"
          />
        </MemoryRouter>
      );

      expect(html).toContain('Cached Snapshot');
      expect(html).toContain('You are currently offline. Showing cached rentals');
    });

    it('renders "Internet Connection Required" when offline and no snapshot exists', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: {
          id: 1,
          name: 'Sarah Chen (Admin)',
          email: 'admin@space-exs.com',
          role: 'admin',
        },
        status: 'authenticated',
        login: vi.fn(),
        logout: vi.fn(),
      });

      const html = renderToString(
        <MemoryRouter initialEntries={['/admin/rentals']}>
          <AdminRentalsPage
            initialRentals={[]}
            initialLoading={false}
            initialDataSource="none"
            initialError="Internet connection required to load rentals"
          />
        </MemoryRouter>
      );

      expect(html).toContain('Internet Connection Required:');
      expect(html).toContain('Internet connection required to load rentals');
    });
  });

  describe('StaffRentalsPage — STRICT Privacy & Operational Guards', () => {
    it('renders active rentals for staff with operational details', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: {
          id: 2,
          name: 'Tariq Mansour (Yard Lead)',
          email: 'staff@space-exs.com',
          role: 'staff',
        },
        status: 'authenticated',
        login: vi.fn(),
        logout: vi.fn(),
      });

      const html = renderToString(
        <MemoryRouter initialEntries={['/staff/rentals']}>
          <StaffRentalsPage
            initialRentals={mockAdminRentals.filter((r) => r.status === 'confirmed' || r.status === 'picked_up')}
            initialLoading={false}
            initialDataSource="live"
          />
        </MemoryRouter>
      );

      // Verify title & operational metrics
      expect(html).toContain('Active Rentals');
      expect(html).toContain('Awaiting Yard Dispatch');
      expect(html).toContain('Active on Client Sites');
      expect(html).toContain('All Active');
      expect(html).toContain('Destination Site');

      // Verify operational rows
      expect(html).toContain('#101');
      expect(html).toContain('#103');
      expect(html).toContain('Ras Tanura Refinery Unit 4');

      // Staff must NOT have New Rental button (Admin only)
      expect(html).not.toContain('+ New Rental');
    });

    it('STRICT PRIVACY INVARIANT: Staff page contains ZERO monetary figures and ZERO customer contact info', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: {
          id: 2,
          name: 'Tariq Mansour (Yard Lead)',
          email: 'staff@space-exs.com',
          role: 'staff',
        },
        status: 'authenticated',
        login: vi.fn(),
        logout: vi.fn(),
      });

      const html = renderToString(
        <MemoryRouter initialEntries={['/staff/rentals']}>
          <StaffRentalsPage
            initialRentals={mockAdminRentals.filter((r) => r.status === 'confirmed' || r.status === 'picked_up')}
            initialLoading={false}
            initialDataSource="live"
          />
        </MemoryRouter>
      );

      // 1. Zero money or rates
      expect(html).not.toContain('SAR');
      expect(html).not.toContain('applied_rate');
      expect(html).not.toContain('Agreed Rate');
      expect(html).not.toContain('Standard card');
      expect(html).not.toContain('Rate Card');
      expect(html).not.toContain('discount');

      // 2. Zero customer contact info (no phone, no email, no contact person)
      expect(html).not.toContain('customer_contact');
      expect(html).not.toContain('customer_phone');
      expect(html).not.toContain('Customer Contact');
      expect(html).not.toContain('Customer Phone');
      expect(html).not.toContain('phone');
      expect(html).not.toContain('email');
    });

    it('renders snapshot banner for staff when offline with cached active rentals', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
        user: {
          id: 2,
          name: 'Tariq Mansour (Yard Lead)',
          email: 'staff@space-exs.com',
          role: 'staff',
        },
        status: 'authenticated',
        login: vi.fn(),
        logout: vi.fn(),
      });

      const html = renderToString(
        <MemoryRouter initialEntries={['/staff/rentals']}>
          <StaffRentalsPage
            initialRentals={mockAdminRentals.filter((r) => r.status === 'confirmed' || r.status === 'picked_up')}
            initialLoading={false}
            initialDataSource="snapshot"
            initialSavedAt="2026-10-30T10:00:00Z"
          />
        </MemoryRouter>
      );

      expect(html).toContain('Cached Snapshot (Offline)');
      expect(html).toContain('You are offline. Showing cached active rentals');
    });
  });
});
