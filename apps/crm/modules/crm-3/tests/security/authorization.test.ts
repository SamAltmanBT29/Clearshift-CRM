import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sign, type KeyObject } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Roles, signAccessToken, getSigningKeys, defaultUserStore, type RoleType } from '@cs/identity';
import { CRM3_API_PREFIX } from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { crm3Routes } from '../../src/routes/crm3.routes.js';
import { Crm3Service } from '../../src/services/crm3.service.js';
import {
  CRM3_ENDPOINT_ROLES,
  isRoleAllowed,
  assertTenantIsolation,
  assertRecordOwnership,
  assertNoImmutableFieldMutation,
  type AuthenticatedUser,
} from '../../src/policies/roles.js';
import {
  maskBankDetails,
  maskSalary,
  sanitizeCsvField,
  maskSensitiveLog,
  redactSensitiveObject,
} from '../../src/policies/masking.js';
import { crm3Audit } from '../../src/services/audit.js';

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
    crm3Audit.resetLedger();
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

    it('rejects a token with disabled: true claim', async () => {
      await expect401(`Bearer ${await signRawToken(validClaims({ disabled: true }))}`);
    });

    it('rejects a token with status: "disabled" claim', async () => {
      await expect401(`Bearer ${await signRawToken(validClaims({ status: 'disabled' }))}`);
    });

    it('rejects a token for a user whose store record is disabled', async () => {
      const disabledToken = await signAccessToken('user-disabled-01', [Roles.VIEWER]);
      await expect401(`Bearer ${disabledToken}`);
    });
  });

  describe('multi-tenant boundary enforcement', () => {
    it('rejects cross-tenant access with 403 when token tenant mismatches x-tenant-id header', async () => {
      const token = await signRawToken(validClaims({ tenant_id: 'tenant-omega' }));
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': 'tenant-alpha',
        },
      });
      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toContain('Multi-tenant boundary violation');
    });

    it('allows access when token tenant matches x-tenant-id header', async () => {
      const token = await signRawToken(validClaims({ tenant_id: 'tenant-alpha' }));
      const response = await app.inject({
        method: 'GET',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: {
          authorization: `Bearer ${token}`,
          'x-tenant-id': 'tenant-alpha',
        },
      });
      expect(response.statusCode).toBe(200);
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

  describe('sensitive-field protection & masking policy', () => {
    describe('maskBankDetails', () => {
      it('masks standard bank accounts/card numbers preserving terminal 4 digits', () => {
        expect(maskBankDetails('1234567890123456')).toBe('XXXX-XXXX-3456');
        expect(maskBankDetails('1111-2222-3333-7890')).toBe('XXXX-XXXX-7890');
      });

      it('returns XXXX-XXXX-XXXX when fewer than 4 digits are provided', () => {
        expect(maskBankDetails('123')).toBe('XXXX-XXXX-XXXX');
        expect(maskBankDetails('ab')).toBe('XXXX-XXXX-XXXX');
      });

      it('handles empty or missing inputs gracefully', () => {
        expect(maskBankDetails('')).toBe('');
      });
    });

    describe('maskSalary', () => {
      it('masks numeric and string compensation to XX,XXX', () => {
        expect(maskSalary(125000)).toBe('XX,XXX');
        expect(maskSalary('85000')).toBe('XX,XXX');
      });

      it('returns "salary hidden" when salary value is null or undefined', () => {
        expect(maskSalary(null)).toBe('salary hidden');
        expect(maskSalary(undefined)).toBe('salary hidden');
      });
    });

    describe('sanitizeCsvField', () => {
      it('neutralizes formula injection characters (=, +, -, @, \\t, \\r)', () => {
        expect(sanitizeCsvField('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
        expect(sanitizeCsvField('+12345')).toBe("'+12345");
        expect(sanitizeCsvField('-CMD')).toBe("'-CMD");
        expect(sanitizeCsvField('@HYPERLINK("http://evil.com")')).toBe("'@HYPERLINK(\"http://evil.com\")");
        expect(sanitizeCsvField('\tTAB_VAL')).toBe("'\tTAB_VAL");
        expect(sanitizeCsvField('\rCR_VAL')).toBe("'\rCR_VAL");
      });

      it('leaves benign text and numbers unmodified', () => {
        expect(sanitizeCsvField('Clean ticket title')).toBe('Clean ticket title');
        expect(sanitizeCsvField(42)).toBe('42');
        expect(sanitizeCsvField(null)).toBe('');
      });
    });

    describe('maskSensitiveLog', () => {
      it('redacts tokens, credentials and passwords in log strings', () => {
        const log = 'Bearer cs_9876543210abcdef9876543210abcdef credential: "secretpassword"';
        const masked = maskSensitiveLog(log);
        expect(masked).not.toContain('cs_9876543210abcdef9876543210abcdef');
        expect(masked).not.toContain('secretpassword');
        expect(masked).toContain('[REDACTED_TOKEN]');
      });

      it('masks 16-digit card/bank groupings and salary expressions', () => {
        const log = 'User bank 1234-5678-9012-3456 with salary: 120000 updated';
        const masked = maskSensitiveLog(log);
        expect(masked).toContain('XXXX-XXXX-3456');
        expect(masked).toContain('salary: XX,XXX');
        expect(masked).not.toContain('1234-5678-9012-3456');
        expect(masked).not.toContain('120000');
      });
    });

    describe('redactSensitiveObject', () => {
      it('recursively redacts credentials and masks bank/salary in objects', () => {
        const raw = {
          ticketId: TICKET_ID,
          password: 'plain_password',
          secret_key: 'supersecret',
          bank_account: '9876543210987654',
          employee: {
            salary: 95000,
            token: 'bearer sensitive-token',
          },
        };
        const redacted = redactSensitiveObject(raw);
        expect(redacted.ticketId).toBe(TICKET_ID);
        expect(redacted.password).toBe('[REDACTED]');
        expect(redacted.secret_key).toBe('[REDACTED]');
        expect(redacted.bank_account).toBe('XXXX-XXXX-7654');
        expect(redacted.employee.salary).toBe('XX,XXX');
        expect(redacted.employee.token).toBe('[REDACTED]');
      });
    });
  });

  describe('append-only audit trail & safe logging', () => {
    it('records an audit event on POST /tickets with safe diff', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/tickets`,
        headers: headersFor('editor'),
        payload: {
          subject: 'Audited Ticket Creation',
          contactId: CONTACT_ID,
          priority: 'High',
        },
      });
      expect(response.statusCode).toBe(201);
      const created = response.json();

      const events = crm3Audit.getAuditEvents({ entity: 'ticket', entityId: created.id });
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.actor).toBe('synthetic-editor');
      expect(event.action).toBe('ticket.created');
      expect(event.result).toBe('success');
      expect(event.diffRedacted).toMatchObject({
        subject: 'Audited Ticket Creation',
        priority: 'High',
      });
      expect(event.createdAt instanceof Date).toBe(true);
    });

    it('records an audit event on PATCH /tickets/:id with diff', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${CRM3_API_PREFIX}/tickets/${TICKET_ID}`,
        headers: headersFor('editor'),
        payload: { priority: 'Urgent' },
      });
      expect(response.statusCode).toBe(200);

      const events = crm3Audit.getAuditEvents({ entity: 'ticket', entityId: TICKET_ID, action: 'ticket.updated' });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const event = events[events.length - 1]!;
      expect(event.actor).toBe('synthetic-editor');
      expect(event.diffRedacted).toEqual({ priority: 'Urgent' });
    });

    it('records an audit event on note creation with metadata', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `${CRM3_API_PREFIX}/notes`,
        headers: headersFor('editor'),
        payload: {
          ticketId: TICKET_ID,
          noteText: 'Audited support note',
        },
      });
      expect(response.statusCode).toBe(201);
      const note = response.json();

      const events = crm3Audit.getAuditEvents({ entity: 'note', entityId: note.id });
      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.action).toBe('note.created');
      expect(event.metadata).toEqual({ ticketId: TICKET_ID });
    });

    it('redacts sensitive fields when logged to audit trail', async () => {
      const logged = await crm3Audit.logEvent({
        actor: 'synthetic-editor',
        action: 'import.processed',
        entity: 'import_batch',
        batchId: 'batch-001',
        result: 'success',
        diff: {
          raw_password: 'super_secret_value',
          bank_number: '1234567890123456',
          salary: 100000,
        },
        metadata: {
          secret_token: 'ghp_abc1234567890123456789012345678901234',
        },
      });

      expect(logged.diffRedacted?.raw_password).toBe('[REDACTED]');
      expect(logged.diffRedacted?.bank_number).toBe('XXXX-XXXX-3456');
      expect(logged.diffRedacted?.salary).toBe('XX,XXX');
      expect(logged.metadata?.secret_token).toBe('[REDACTED]');
    });
  });

  describe('security policy helper invariants', () => {
    it('assertTenantIsolation enforces tenant match and allows admin cross-tenant', () => {
      const regularUser: AuthenticatedUser = {
        sub: 'usr-1',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.EDITOR],
        tenant_id: 'tenant-a',
      };
      const adminUser: AuthenticatedUser = {
        sub: 'usr-admin',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.ADMIN],
        tenant_id: 'tenant-a',
      };

      expect(() => assertTenantIsolation(regularUser, 'tenant-a')).not.toThrow();
      expect(() => assertTenantIsolation(regularUser, 'tenant-b')).toThrow(/Multi-tenant boundary violation/);
      expect(() => assertTenantIsolation(adminUser, 'tenant-b')).not.toThrow();
    });

    it('assertRecordOwnership restricts modifications to author or admin', () => {
      const regularUser: AuthenticatedUser = {
        sub: 'usr-author',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.EDITOR],
      };
      const otherUser: AuthenticatedUser = {
        sub: 'usr-other',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.EDITOR],
      };
      const adminUser: AuthenticatedUser = {
        sub: 'usr-admin',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.ADMIN],
      };

      expect(() => assertRecordOwnership(regularUser, 'usr-author')).not.toThrow();
      expect(() => assertRecordOwnership(otherUser, 'usr-author')).toThrow(/unauthorized cross-user mutation/);
      expect(() => assertRecordOwnership(adminUser, 'usr-author')).not.toThrow();
    });

    it('assertNoImmutableFieldMutation rejects protected fields from non-admin', () => {
      const editorUser: AuthenticatedUser = {
        sub: 'usr-editor',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.EDITOR],
      };
      const adminUser: AuthenticatedUser = {
        sub: 'usr-admin',
        iss: 'clearshift-hub',
        aud: 'clearshift',
        roles: [Roles.ADMIN],
      };

      expect(() => assertNoImmutableFieldMutation(editorUser, { subject: 'New Subject' })).not.toThrow();
      expect(() => assertNoImmutableFieldMutation(editorUser, { id: '30000000-0000-4000-8000-000000000001' })).toThrow(/immutable field 'id'/);
      expect(() => assertNoImmutableFieldMutation(adminUser, { id: '30000000-0000-4000-8000-000000000001' })).not.toThrow();
    });
  });
});
