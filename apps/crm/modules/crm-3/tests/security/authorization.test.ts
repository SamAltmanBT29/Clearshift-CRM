import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sign, type KeyObject } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Roles, signAccessToken, getSigningKeys, type RoleType } from '@cs/identity';
import { CRM3_API_PREFIX } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { crm3Routes } from '../../src/routes/crm3.routes.js';
import { Crm3Service } from '../../src/services/crm3.service.js';
import { CRM3_ENDPOINT_ROLES, isRoleAllowed } from '../../src/policies/roles.js';

const TICKET_ID = '30000000-0000-4000-8000-000000000001';
const CONTACT_ID = '90000000-0000-4000-8000-000000000001';

type Principal = 'viewer' | 'editor' | 'migration_runner' | 'analyst' | 'admin' | 'anonymous';
const PRINCIPALS: Principal[] = ['viewer', 'editor', 'migration_runner', 'analyst', 'admin', 'anonymous'];

interface RouteCase {
  name: string;
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  payload?: Record<string, unknown>;
  success: number;
  allowed: Principal[];
}

const READ_ALLOWED: Principal[] = ['viewer', 'editor', 'analyst', 'admin'];

const ROUTES: RouteCase[] = [
  { name: 'GET /tickets', method: 'GET', url: '/tickets', success: 200, allowed: READ_ALLOWED },
  { name: 'GET /tickets/:id', method: 'GET', url: `/tickets/${TICKET_ID}`, success: 200, allowed: READ_ALLOWED },
  { name: 'GET /tickets/:id/notes', method: 'GET', url: `/tickets/${TICKET_ID}/notes`, success: 200, allowed: READ_ALLOWED },
  {
    name: 'POST /tickets',
    method: 'POST',
    url: '/tickets',
    payload: { subject: 'Synthetic auth matrix ticket', contactId: CONTACT_ID },
    success: 201,
    allowed: ['editor', 'migration_runner', 'admin'],
  },
  {
    name: 'PATCH /tickets/:id',
    method: 'PATCH',
    url: `/tickets/${TICKET_ID}`,
    payload: { priority: 'High' },
    success: 200,
    allowed: ['editor', 'admin'],
  },
  {
    name: 'POST /notes',
    method: 'POST',
    url: '/notes',
    payload: { ticketId: TICKET_ID, noteText: 'Synthetic auth matrix note' },
    success: 201,
    allowed: ['editor', 'admin'],
  },
  {
    name: 'POST /tickets/:id/notes',
    method: 'POST',
    url: `/tickets/${TICKET_ID}/notes`,
    payload: { noteText: 'Synthetic auth matrix note' },
    success: 201,
    allowed: ['editor', 'admin'],
  },
];

const MATRIX = ROUTES.flatMap((route) =>
  PRINCIPALS.map((principal) => {
    const expected = principal === 'anonymous' ? 401 : route.allowed.includes(principal) ? route.success : 403;
    return [route.name, principal, expected, route] as const;
  })
);

const base64url = (input: string | Uint8Array) => Buffer.from(input).toString('base64url');

/** Signs a JWT with the Hub's active Ed25519 key, letting a test set any claims (e.g. a past exp). */
async function signRawToken(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const keys = await getSigningKeys();
  const head = base64url(JSON.stringify({ alg: 'EdDSA', kid: 'cs-hub-key-v1', ...header }));
  const body = base64url(JSON.stringify(claims));
  const signature = sign(null, Buffer.from(`${head}.${body}`), keys.privateKey as unknown as KeyObject);
  return `${head}.${body}.${base64url(signature)}`;
}

const validClaims = (overrides: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return {
    roles: [Roles.ADMIN],
    iss: 'clearshift-hub',
    aud: 'clearshift',
    sub: 'synthetic-admin',
    iat: now,
    exp: now + 900,
    ...overrides,
  };
};

describe('CRM-3 authorization policy (#148 / CRM3-15)', () => {
  let app: FastifyInstance;
  let service: Crm3Service;
  const tokens: Partial<Record<Principal, string>> = {};

  beforeAll(async () => {
    const roleFor: Record<Exclude<Principal, 'anonymous'>, RoleType> = {
      viewer: Roles.VIEWER,
      editor: Roles.EDITOR,
      migration_runner: Roles.MIGRATION_RUNNER,
      analyst: Roles.ANALYST,
      admin: Roles.ADMIN,
    };
    for (const [principal, role] of Object.entries(roleFor)) {
      tokens[principal as Principal] = await signAccessToken(`synthetic-${principal}`, [role]);
    }
  });

  beforeEach(async () => {
    service = new Crm3Service();
    app = buildApp({ service, enforceAuth: true });
    await app.ready();
  });

  const headersFor = (principal: Principal) =>
    principal === 'anonymous' ? {} : { authorization: `Bearer ${tokens[principal]}` };

  describe('route x role matrix', () => {
    it('covers all 7 routes for all 5 roles plus no token', () => {
      expect(MATRIX).toHaveLength(42);
    });

    it.each(MATRIX)('%s as %s -> %i', async (_name, principal, expected, route) => {
      const response = await app.inject({
        method: route.method,
        url: `${CRM3_API_PREFIX}${route.url}`,
        headers: headersFor(principal),
        ...(route.payload ? { payload: route.payload } : {}),
      });

      expect(response.statusCode).toBe(expected);
      if (expected === 401 || expected === 403) {
        const body = response.json();
        expect(body.code).toBe(expected === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN');
        expect(typeof body.message).toBe('string');
        expect(Array.isArray(body.details)).toBe(true);
        expect(typeof body.correlation_id).toBe('string');
      }
    });

    it('policy constants match the tested matrix', () => {
      const keyFor: Record<string, keyof typeof CRM3_ENDPOINT_ROLES> = {
        'GET /tickets': 'TICKETS_LIST',
        'GET /tickets/:id': 'TICKETS_READ',
        'GET /tickets/:id/notes': 'NOTES_LIST',
        'POST /tickets': 'TICKETS_CREATE',
        'PATCH /tickets/:id': 'TICKETS_UPDATE',
        'POST /notes': 'NOTES_CREATE',
        'POST /tickets/:id/notes': 'NOTES_CREATE',
      };
      for (const route of ROUTES) {
        const key = keyFor[route.name];
        expect(key).toBeDefined();
        const allowedByPolicy = PRINCIPALS.filter(
          (p) => p !== 'anonymous' && isRoleAllowed([p], CRM3_ENDPOINT_ROLES[key!])
        );
        expect(allowedByPolicy.sort()).toEqual([...route.allowed].sort());
      }
    });

    it('isRoleAllowed denies empty roles and lets admin through everywhere', () => {
      expect(isRoleAllowed([], CRM3_ENDPOINT_ROLES.TICKETS_LIST)).toBe(false);
      expect(isRoleAllowed(undefined, CRM3_ENDPOINT_ROLES.TICKETS_LIST)).toBe(false);
      expect(isRoleAllowed(['unknown-role'], CRM3_ENDPOINT_ROLES.TICKETS_LIST)).toBe(false);
      for (const roles of Object.values(CRM3_ENDPOINT_ROLES)) {
        expect(isRoleAllowed([Roles.ADMIN], roles)).toBe(true);
      }
    });
  });

  describe('Hub JWT validation (401)', () => {
    const getTickets = (authorization?: string) =>
      app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: authorization ? { authorization } : {},
      });

    const expect401 = async (authorization?: string) => {
      const response = await getTickets(authorization);
      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code).toBe('UNAUTHORIZED');
      expect(typeof body.correlation_id).toBe('string');
    };

    it('accepts a correctly signed raw token (helper sanity check)', async () => {
      const response = await getTickets(`Bearer ${await signRawToken(validClaims())}`);
      expect(response.statusCode).toBe(200);
    });

    it('rejects a missing Authorization header', async () => {
      await expect401();
    });

    it('rejects a non-Bearer scheme', async () => {
      await expect401(`Basic ${tokens.admin}`);
    });

    it('rejects an empty Bearer token', async () => {
      await expect401('Bearer ');
    });

    it('rejects a malformed token', async () => {
      await expect401('Bearer not.a.jwt');
    });

    it('rejects an expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expect401(`Bearer ${await signRawToken(validClaims({ iat: now - 1200, exp: now - 300 }))}`);
    });

    it('rejects a token without exp', async () => {
      const { exp: _exp, ...claims } = validClaims();
      await expect401(`Bearer ${await signRawToken(claims)}`);
    });

    it('rejects a token whose payload was tampered after signing (role escalation)', async () => {
      const [head, , signature] = (tokens.viewer ?? '').split('.');
      const forgedBody = base64url(JSON.stringify(validClaims({ sub: 'synthetic-viewer' })));
      await expect401(`Bearer ${head}.${forgedBody}.${signature}`);
    });

    it('rejects a token with a corrupted signature', async () => {
      const token = tokens.admin ?? '';
      const last = token.at(-2) === 'A' ? 'B' : 'A';
      await expect401(`Bearer ${token.slice(0, -2)}${last}${token.at(-1)}`);
    });

    it('rejects a token from another issuer', async () => {
      await expect401(`Bearer ${await signRawToken(validClaims({ iss: 'untrusted-issuer' }))}`);
    });

    it('rejects a token for another audience', async () => {
      await expect401(`Bearer ${await signRawToken(validClaims({ aud: 'foreign-system' }))}`);
    });

    it('rejects an unsigned alg=none token', async () => {
      const head = base64url(JSON.stringify({ alg: 'none' }));
      const body = base64url(JSON.stringify(validClaims()));
      await expect401(`Bearer ${head}.${body}.`);
    });
  });

  describe('object-level guards', () => {
    it('read routes never mutate data, for any role', async () => {
      const before = JSON.stringify(await service.getTickets({ page: 1, pageSize: 100 }));
      const notesBefore = JSON.stringify(await service.getTicketNotes(TICKET_ID, { page: 1, pageSize: 100 }));

      for (const principal of PRINCIPALS) {
        for (const route of ROUTES.filter((r) => r.method === 'GET')) {
          await app.inject({ method: 'GET', url: `${CRM3_API_PREFIX}${route.url}`, headers: headersFor(principal) });
        }
      }

      expect(JSON.stringify(await service.getTickets({ page: 1, pageSize: 100 }))).toBe(before);
      expect(JSON.stringify(await service.getTicketNotes(TICKET_ID, { page: 1, pageSize: 100 }))).toBe(notesBefore);
    });

    it('a rejected write by a forbidden role changes nothing', async () => {
      const before = await service.getTicketById(TICKET_ID);
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${TICKET_ID}`,
        headers: headersFor('viewer'),
        payload: { subject: 'Viewer tried to edit' },
      });
      expect(response.statusCode).toBe(403);
      expect(await service.getTicketById(TICKET_ID)).toEqual(before);
    });

    it.each(['id', 'createdAt', 'updatedAt', 'sourceSystem', 'sourceId'])(
      'PATCH cannot set protected field %s (400) and the ticket is unchanged',
      async (field) => {
        const before = await service.getTicketById(TICKET_ID);
        const response = await app.inject({
          method: 'PATCH',
          url: `${CRM3_API_PREFIX}/tickets/${TICKET_ID}`,
          headers: headersFor('admin'),
          payload: { priority: 'High', [field]: 'forged-value' },
        });
        expect(response.statusCode).toBe(400);
        expect(await service.getTicketById(TICKET_ID)).toEqual(before);
      }
    );

    describe.each([
      ['POST /notes', '/notes', (authorId?: string) => ({ ticketId: TICKET_ID, noteText: 'Author check', ...(authorId ? { authorId } : {}) })],
      ['POST /tickets/:id/notes', `/tickets/${TICKET_ID}/notes`, (authorId?: string) => ({ noteText: 'Author check', ...(authorId ? { authorId } : {}) })],
    ])('%s note author', (_name, url, payloadFor) => {
      it('is taken from the token subject when authorId is omitted', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM3_API_PREFIX}${url}`,
          headers: headersFor('editor'),
          payload: payloadFor(),
        });
        expect(response.statusCode).toBe(201);
        expect(response.json().authorId).toBe('synthetic-editor');
      });

      it('accepts an authorId equal to the token subject', async () => {
        const response = await app.inject({
          method: 'POST',
          url: `${CRM3_API_PREFIX}${url}`,
          headers: headersFor('editor'),
          payload: payloadFor('synthetic-editor'),
        });
        expect(response.statusCode).toBe(201);
        expect(response.json().authorId).toBe('synthetic-editor');
      });

      it('rejects writing a note as another user with 403 AUTHOR_MISMATCH and writes nothing', async () => {
        const before = await service.getTicketNotes(TICKET_ID, { page: 1, pageSize: 100 });
        const response = await app.inject({
          method: 'POST',
          url: `${CRM3_API_PREFIX}${url}`,
          headers: headersFor('editor'),
          payload: payloadFor('synthetic-admin'),
        });
        expect(response.statusCode).toBe(403);
        const body = response.json();
        expect(body.code).toBe('AUTHOR_MISMATCH');
        expect(body.details[0]).toMatchObject({ field: 'authorId', code: 'author_mismatch' });
        expect(typeof body.correlation_id).toBe('string');
        expect((await service.getTicketNotes(TICKET_ID, { page: 1, pageSize: 100 })).total).toBe(before.total);
      });
    });
  });

  describe('fail-closed registration', () => {
    it('refuses to register routes with auth enabled when the Hub JWT plugin is missing', async () => {
      const bare = Fastify({ logger: false });
      bare.register(crm3Routes, { prefix: CRM3_API_PREFIX, service: new Crm3Service() });
      await expect(bare.ready()).rejects.toThrow(/jwtPlugin/);
    });

    it('still allows an explicit enforceAuth: false for isolated tests', async () => {
      const bare = Fastify({ logger: false });
      bare.register(crm3Routes, { prefix: CRM3_API_PREFIX, service: new Crm3Service(), enforceAuth: false });
      await bare.ready();
      const response = await bare.inject({ method: 'GET', url: `${CRM3_API_PREFIX}/tickets` });
      expect(response.statusCode).toBe(200);
    });
  });
});
