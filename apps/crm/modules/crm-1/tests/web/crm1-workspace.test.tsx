// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Roles } from '@cs/identity';
import type { CRM1ContactRead } from '@clearshift/contracts/crm-1';
import { Crm1Workspace } from '../../web/Crm1Workspace.js';

const contact = {
  id: '00000000-0000-4000-8000-000000000001',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.test',
  phone: '+1-555-0100',
  address: '1 Example Street',
  companyId: null,
  companyName: null,
  leadStatus: 'Working' as const,
  goldenId: 'golden-ada',
  sourceSystem: 'manual',
  sourceId: 'ada-001',
  consentStatus: 'granted' as const,
  consentUpdatedAt: '2026-01-01T00:00:00.000Z',
  unsubscribed: false,
  unsubscribedUpdatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const secondContact = {
  ...contact,
  id: '00000000-0000-4000-8000-000000000002',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.test',
  goldenId: 'golden-grace',
};

const company = {
  id: '00000000-0000-4000-8000-000000000010',
  name: 'Synthetic Systems',
  taxNumber: 'SYN-001',
  email: 'accounts@example.test',
  phone: '+1-555-0101',
  address: '2 Example Street',
  sourceSystem: 'fixture',
  sourceId: 'company-001',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const lead = {
  id: '00000000-0000-4000-8000-000000000020',
  contactId: contact.id,
  contactName: 'Ada Lovelace',
  contactEmail: contact.email,
  status: 'New',
  sourceSystem: 'fixture',
  sourceId: 'lead-001',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const importBatch = {
  id: '00000000-0000-4000-8000-000000000030',
  sourceSystem: 'synthetic-fixture',
  status: 'completed',
  loadedCount: 1,
  rejectedCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:01:00.000Z',
  completedAt: '2026-01-01T00:01:00.000Z',
};

describe('CRM-1 API-backed workspace', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let contacts: CRM1ContactRead[];
  let failContactsOnce: boolean;
  let requests: URL[];

  beforeEach(() => {
    contacts = [contact, secondContact];
    failContactsOnce = false;
    requests = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      requests.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
      const page = Number(url.searchParams.get('page') ?? 1);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 25);

      if (url.pathname.endsWith('/contacts') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as Partial<typeof contact>;
        const created: CRM1ContactRead = {
          ...contact,
          ...payload,
          id: '00000000-0000-4000-8000-000000000003',
          companyName: null,
          sourceSystem: null,
          sourceId: null,
          consentStatus: 'unknown',
          consentUpdatedAt: null,
          unsubscribed: false,
          unsubscribedUpdatedAt: null,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        };
        contacts = [created, ...contacts];
        return json(created, 201);
      }

      if (url.pathname.endsWith('/contacts')) {
        if (failContactsOnce) {
          failContactsOnce = false;
          return json({ error: { code: 'TEMPORARY_FAILURE', message: 'Please retry.' } }, 503);
        }
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const status = url.searchParams.get('leadStatus');
        const matched = contacts.filter((record) =>
          (!search || `${record.firstName} ${record.lastName} ${record.email}`.toLowerCase().includes(search)) &&
          (!status || record.leadStatus === status)
        );
        const items = search || status
          ? matched.slice((page - 1) * pageSize, page * pageSize)
          : (page === 1 ? [contacts[0]] : [contacts[1]]).filter(Boolean);
        return json({
          items,
          page,
          pageSize,
          total: search || status ? matched.length : 26,
        });
      }

      if (url.pathname.endsWith('/companies')) {
        return json({ items: [company], page, pageSize, total: 1 });
      }

      if (url.pathname.endsWith('/leads')) {
        return json({ items: [lead], page, pageSize, total: 1 });
      }

      if (url.pathname.endsWith(`/imports/${importBatch.id}/rejects`)) {
        return json({
          items: [{
            id: '00000000-0000-4000-8000-000000000040',
            batchId: importBatch.id,
            sourceRow: 2,
            entity: 'contact',
            reasonCode: 'INVALID_EMAIL',
            message: 'Email does not match the required format.',
            createdAt: '2026-01-01T00:01:00.000Z',
          }],
          page,
          pageSize,
          total: 1,
        });
      }

      if (url.pathname.endsWith(`/imports/${importBatch.id}`)) {
        return json({ ...importBatch, receipts: [] });
      }

      if (url.pathname.endsWith('/imports')) {
        return json({ items: [importBatch], page, pageSize, total: 1 });
      }

      return json({ items: [], page, pageSize, total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const renderWorkspace = (roles: typeof Roles[keyof typeof Roles][] = [Roles.EDITOR]) =>
    render(
      <Crm1Workspace
        getAccessToken={() => 'synthetic-access-token'}
        roles={roles}
      />
    );

  it('loads and displays persisted contacts with a server page size of 25', async () => {
    renderWorkspace([Roles.VIEWER]);

    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ada@example.test' }).getAttribute('href')).toBe(
      'mailto:ada%40example.test'
    );
    expect(requests[0]?.searchParams.get('pageSize')).toBe('25');
    expect(screen.getByRole('columnheader', { name: 'Golden ID' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Source System' })).toBeTruthy();
  });

  it('sends search and filter changes to the server and resets pagination', async () => {
    renderWorkspace();
    expect(await screen.findByText('Ada')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    await waitFor(() => {
      expect(requests.some((url) => url.searchParams.get('page') === '2')).toBe(true);
    });
    expect(await screen.findByText('Grace')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ada' } });
    await waitFor(() => {
      expect(requests.some((url) =>
        url.searchParams.get('search') === 'ada' &&
        url.searchParams.get('page') === '1'
      )).toBe(true);
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Lead Status' }), {
      target: { value: 'Working' },
    });
    await waitFor(() => {
      expect(requests.some((url) =>
        url.searchParams.get('leadStatus') === 'Working' &&
        url.searchParams.get('page') === '1'
      )).toBe(true);
    });
  });

  it('renders a distinct empty state when the server returns no matches', async () => {
    renderWorkspace();
    expect(await screen.findByText('Ada')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-such-contact' } });
    const noResults = await screen.findByRole('status', { name: 'No matching records found' });
    expect(within(noResults).getByText(/No contacts match your search/)).toBeTruthy();
  });

  it('shows a recoverable API failure and retries successfully', async () => {
    failContactsOnce = true;
    renderWorkspace();
    expect(await screen.findByRole('alert')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry failed operation' }));
    expect(await screen.findByText('Ada')).toBeTruthy();
  });

  it('shows permission denial without issuing a forbidden list request or exposing write actions', async () => {
    renderWorkspace([Roles.MIGRATION_RUNNER]);

    expect(await screen.findByText('Access Denied')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create contact' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads companies, leads, import batches, and rejects from their API collections', async () => {
    renderWorkspace([Roles.ADMIN]);
    expect(await screen.findByText('Ada')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Companies' }));
    expect(await screen.findByText('Synthetic Systems')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Leads' }));
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Imports' }));
    expect(await screen.findByText('synthetic-fixture')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', {
      name: `View details and rejected rows for batch ${importBatch.id}`,
    }));
    expect(await screen.findByText('Email does not match the required format.')).toBeTruthy();
    expect(requests.some((url) => url.pathname.endsWith('/companies'))).toBe(true);
    expect(requests.some((url) => url.pathname.endsWith('/leads'))).toBe(true);
    expect(requests.some((url) => url.pathname.endsWith(`/imports/${importBatch.id}/rejects`))).toBe(true);
  });

  it('limits edited lead status options to the current and allowed next lifecycle state', async () => {
    renderWorkspace([Roles.ADMIN]);
    fireEvent.click(await screen.findByRole('tab', { name: 'Leads' }));
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const statusSelect = await screen.findByRole('combobox', { name: 'Lead status' });
    expect(within(statusSelect).getByRole('option', { name: 'New' })).toBeTruthy();
    expect(within(statusSelect).getByRole('option', { name: 'Working' })).toBeTruthy();
    expect(within(statusSelect).queryByRole('option', { name: 'Qualified' })).toBeNull();
    expect(within(statusSelect).queryByRole('option', { name: 'Closed' })).toBeNull();
  });

  it('creates a contact through the public API and refreshes the server list', async () => {
    renderWorkspace();
    expect(await screen.findByText('Ada')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create contact' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), {
      target: { value: 'Katherine' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), {
      target: { value: 'Johnson' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
      target: { value: 'katherine@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Katherine')).toBeTruthy();
    expect(requests.some((url) => url.pathname.endsWith('/contacts') && url.search === '')).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
  });
});
