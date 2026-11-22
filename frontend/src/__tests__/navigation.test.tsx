/**
 * Navigation Role & Visibility Tests
 *
 * Requirements:
 * - Admin navigation (desktop and mobile) renders links to Invoices and Materials.
 * - Staff navigation renders Stock/Materials and does NOT render Invoices.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from '../pages/layouts/AppLayout';
import * as AuthContextModule from '../context/AuthContext';

// Mock sub-components/hooks that rely on browser globals or indexedDB
vi.mock('../components/OnlineStatusBadge', () => ({
  OnlineStatusBadge: () => React.createElement('div', { 'data-testid': 'online-status-badge' }),
}));

vi.mock('../components/OutboxBadge', () => ({
  OutboxBadge: () => React.createElement('div', { 'data-testid': 'outbox-badge' }),
}));

vi.mock('../offline/outbox', () => ({
  listEvents: vi.fn().mockResolvedValue([]),
  clearOutboxForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sync/syncManager', () => ({
  startOnlineSync: vi.fn().mockReturnValue(() => {}),
}));

describe('Navigation Role Visibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders Invoices and Materials in both desktop and mobile nav for admin role', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 1,
        name: 'Admin User',
        email: 'admin@spaceexspace.com',
        role: 'admin',
      },
      status: 'authenticated',
      login: vi.fn(),
      logout: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/admin']}>
        <AppLayout />
      </MemoryRouter>
    );

    // Desktop navigation checks
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('href="/admin/invoices"');
    expect(html).toContain('href="/admin/materials"');
    expect(html).toContain('Invoices');
    expect(html).toContain('Materials');

    // Mobile navigation checks
    expect(html).toContain('aria-label="Mobile navigation"');
    expect(html).toContain('class="mobile-bottom-nav"');

    // Both nav bars should render the invoice route
    const invoiceMatches = html.match(/href="\/admin\/invoices"/g);
    expect(invoiceMatches).not.toBeNull();
    expect(invoiceMatches?.length).toBe(2); // One in desktop nav, one in mobile nav

    // Both nav bars should render the materials route
    const materialsMatches = html.match(/href="\/admin\/materials"/g);
    expect(materialsMatches).not.toBeNull();
    expect(materialsMatches?.length).toBe(2); // One in desktop nav, one in mobile nav
  });

  it('does NOT render Invoices in desktop or mobile nav for staff role, but renders Stock/Materials', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 2,
        name: 'Staff Worker',
        email: 'staff@spaceexspace.com',
        role: 'staff',
      },
      status: 'authenticated',
      login: vi.fn(),
      logout: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/staff']}>
        <AppLayout />
      </MemoryRouter>
    );

    // Staff navigation must NOT contain any link or label for Invoices
    expect(html).not.toContain('href="/admin/invoices"');
    expect(html).not.toContain('href="/staff/invoices"');
    expect(html).not.toContain('Invoices');

    // Staff navigation must contain Stock / Materials
    expect(html).toContain('href="/staff/materials"');
    expect(html).toContain('Stock');

    // Both nav bars should render the staff materials (Stock) route
    const staffStockMatches = html.match(/href="\/staff\/materials"/g);
    expect(staffStockMatches).not.toBeNull();
    expect(staffStockMatches?.length).toBe(2); // One in desktop nav, one in mobile nav
  });
});
