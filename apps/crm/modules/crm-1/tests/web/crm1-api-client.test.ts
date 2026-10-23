import { describe, expect, it, vi } from 'vitest';
import { CRM1_API_PREFIX } from '@clearshift/contracts/crm-1';
import { Crm1ApiClient, Crm1ApiError } from '../../web/api/crm-1.js';

function contactResponse() {
  const now = new Date().toISOString();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    firstName: 'Synthetic',
    lastName: 'Contact',
    email: 'synthetic@example.test',
    phone: null,
    address: null,
    companyId: null,
    companyName: null,
    leadStatus: 'New',
    goldenId: 'gid-synthetic',
    sourceSystem: 'fixture',
    sourceId: 'contact-1',
    consentStatus: 'unknown',
    consentUpdatedAt: null,
    unsubscribed: false,
    unsubscribedUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('CRM-1 browser API client', () => {
  it('uses the authenticated API, sends validated server query parameters, and validates returned records', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      items: [contactResponse()],
      page: 2,
      pageSize: 25,
      total: 26,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = new Crm1ApiClient({
      getAccessToken: () => 'synthetic-token',
      fetchImpl,
    });

    const result = await api.listContacts({ search: 'Alex alex@example.test', page: 2 });

    expect(result).toMatchObject({ page: 2, pageSize: 25, total: 26 });
    expect(result.items[0]?.email).toBe('synthetic@example.test');
    const [url, request] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(url, 'https://clearshift.example.test');
    expect(parsedUrl.pathname).toBe(`${CRM1_API_PREFIX}/contacts`);
    expect(parsedUrl.searchParams.get('search')).toBe('Alex alex@example.test');
    expect(parsedUrl.searchParams.get('page')).toBe('2');
    expect(parsedUrl.searchParams.get('pageSize')).toBe('25');
    expect(new Headers(request.headers).get('authorization')).toBe('Bearer synthetic-token');
  });

  it('validates mutation input before sending a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const api = new Crm1ApiClient({
      getAccessToken: () => 'synthetic-token',
      fetchImpl,
    });

    await expect(api.createContact({ firstName: '', lastName: 'Contact' })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces permission failures using the validated API error envelope', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'FORBIDDEN',
        message: 'You cannot read these contacts.',
        details: [],
      },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    const api = new Crm1ApiClient({
      getAccessToken: () => 'synthetic-token',
      fetchImpl,
    });

    await expect(api.listContacts({})).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'You cannot read these contacts.',
    } satisfies Partial<Crm1ApiError>);
  });

  it('rejects malformed successful responses rather than rendering unchecked data', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      items: [{ id: '<script>alert(1)</script>' }],
      page: 1,
      pageSize: 25,
      total: 1,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = new Crm1ApiClient({
      getAccessToken: () => 'synthetic-token',
      fetchImpl,
    });

    await expect(api.listContacts({})).rejects.toThrow();
  });
});
