import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';
import { Roles, signAccessToken, getSigningKeys } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm4Service } from '../../src/services/crm4.service.js';
import { Crm4AuditService } from '../../src/services/audit.js';
import {
  maskBankDetails,
  maskSalary,
  sanitizeCsvField,
  maskSensitiveLog,
  redactSensitiveObject,
} from '../../src/policies/masking.js';
import { CRM4_ENDPOINT_ROLES, isRoleAllowed } from '../../src/policies/roles.js';
import { checkRouteAuth, HUB_LOGIN_PATH, ACCESS_DENIED_PATH } from '../../web/auth/route-guard.js';
import {
  assertTenantIsolation,
  assertRecordOwnership,
  assertNoImmutableFieldMutation,
  extractTenantId,
  CRM4_ENDPOINT_CAPABILITIES,
  IMMUTABLE_MUTATION_FIELDS,
} from '../../src/interface/authz.js';

describe('CRM-4 Security & Authorization (Issue #44 / [CRM4-15])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm4Service;
  let auditService: Crm4AuditService;

  // Role Tokens
  let viewerToken: string;
  let editorToken: string;
  let analystToken: string;
  let migrationRunnerToken: string;
  let adminToken: string;

  // Header helper
  const headerFor = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    service = new Crm4Service();
    service.seedSyntheticData();
    auditService = new Crm4AuditService();

    app = buildApp({ service, auditService, authEnabled: true });
    await app.ready();

    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    analystToken = await signAccessToken('synthetic-analyst', [Roles.ANALYST]);
    migrationRunnerToken = await signAccessToken('synthetic-migrator', [Roles.MIGRATION_RUNNER]);
    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);
  });

  beforeEach(() => {
    auditService.resetLedger();
  });

  // ===========================================================================
  // 1. Unauthenticated & Invalid JWT Tests (401 Unauthorized)
  // ===========================================================================
  describe('Unauthenticated & Invalid Token Handling (401 Unauthorized)', () => {
    it('returns 401 when Authorization header is completely missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Bearer token is malformed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: { authorization: 'Bearer invalid.jwt.payload' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token is expired', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const expiredToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('expired-user')
        .setExpirationTime(now - 300) // Expired 5 minutes ago
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: headerFor(expiredToken),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token issuer is invalid', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const invalidIssuerToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('untrusted-external-issuer')
        .setAudience('clearshift')
        .setSubject('external-user')
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: headerFor(invalidIssuerToken),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token audience is invalid', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const invalidAudienceToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('foreign-system')
        .setSubject('audience-user')
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: headerFor(invalidAudienceToken),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when user account is marked as disabled in claims', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const disabledToken = await new jose.SignJWT({
        roles: [Roles.ADMIN],
        disabled: true,
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('disabled-user')
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: headerFor(disabledToken),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  // ===========================================================================
  // 2. SDS Role Matrix Enforcement (Marketing Lists Endpoints)
  // ===========================================================================
  describe('Marketing Lists Endpoints SDS Matrix', () => {
    // GET /lists -> viewer, editor, analyst, admin
    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /lists', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-marketing/lists',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /lists with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
    });

    // POST /lists -> editor, admin
    it('allows EDITOR and ADMIN to POST /lists', async () => {
      for (const [idx, token] of [editorToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-marketing/lists',
          headers: headerFor(token),
          payload: {
            name: `Permitted List ${idx}`,
            description: 'Synthetic list test',
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER, ANALYST, and MIGRATION_RUNNER from POST /lists with 403 Forbidden', async () => {
      for (const token of [viewerToken, analystToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-marketing/lists',
          headers: headerFor(token),
          payload: { name: 'Forbidden List' },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // PATCH /lists/:id -> editor, admin
    it('allows EDITOR and ADMIN to PATCH /lists/:id', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      for (const token of [editorToken, adminToken]) {
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-marketing/lists/${listId}`,
          headers: headerFor(token),
          payload: { name: 'Updated List Name' },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER, ANALYST, and MIGRATION_RUNNER from PATCH /lists/:id with 403 Forbidden', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      for (const token of [viewerToken, analystToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-marketing/lists/${listId}`,
          headers: headerFor(token),
          payload: { name: 'Forbidden Update' },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 3. SDS Role Matrix Enforcement (Campaigns Endpoints)
  // ===========================================================================
  describe('Campaigns Endpoints SDS Matrix', () => {
    // GET /campaigns -> viewer, editor, analyst, admin
    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /campaigns', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-marketing/campaigns',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /campaigns with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/campaigns',
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
    });

    // POST /campaigns -> editor, admin
    it('allows EDITOR and ADMIN to POST /campaigns', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      for (const [idx, token] of [editorToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-marketing/campaigns',
          headers: headerFor(token),
          payload: {
            name: `Permitted Campaign ${idx}`,
            campaignDate: '2026-11-20',
            listId,
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER, ANALYST, and MIGRATION_RUNNER from POST /campaigns with 403 Forbidden', async () => {
      const listId = '44444444-1111-4444-8444-000000000001';
      for (const token of [viewerToken, analystToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-marketing/campaigns',
          headers: headerFor(token),
          payload: {
            name: 'Denied Campaign',
            campaignDate: '2026-11-20',
            listId,
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // PATCH /campaigns/:id -> editor, admin
    it('allows EDITOR and ADMIN to PATCH /campaigns/:id', async () => {
      const campId = '44444444-2222-4444-8444-000000000001';
      for (const token of [editorToken, adminToken]) {
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-marketing/campaigns/${campId}`,
          headers: headerFor(token),
          payload: { name: 'Updated Campaign Title' },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects attempt to mutate immutable listId on PATCH /campaigns/:id with 403 Forbidden', async () => {
      const campId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/crm-marketing/campaigns/${campId}`,
        headers: headerFor(editorToken),
        payload: { listId: '44444444-1111-4444-8444-000000000002' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.message || body.error?.message).toContain("immutable field 'listId'");
    });
  });

  // ===========================================================================
  // 4. SDS Role Matrix Enforcement (Members Endpoints)
  // ===========================================================================
  describe('Campaign Members Endpoints SDS Matrix', () => {
    const campId = '44444444-2222-4444-8444-000000000001';

    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /campaigns/:id/members', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /campaigns/:id/members with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows EDITOR and ADMIN to POST /campaigns/:id/members', async () => {
      const newContact = '11111111-1111-4111-8111-000000000003';
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: headerFor(editorToken),
        payload: {
          contactId: newContact,
          status: 'sent',
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects VIEWER, ANALYST, and MIGRATION_RUNNER from POST /campaigns/:id/members with 403', async () => {
      for (const token of [viewerToken, analystToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
          headers: headerFor(token),
          payload: {
            contactId: '11111111-1111-4111-8111-000000000004',
            status: 'sent',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('rejects invalid member status with 400 Validation Error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/crm-marketing/campaigns/${campId}/members`,
        headers: headerFor(editorToken),
        payload: {
          contactId: '11111111-1111-4111-8111-000000000005',
          status: 'bounced', // Arbitrary state forbidden!
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ===========================================================================
  // 5. SDS Role Matrix & BR-CRM4-01 Monotonic Opt-Out (Consents Endpoints)
  // ===========================================================================
  describe('Consents Endpoints & Monotonic Opt-Out (BR-CRM4-01)', () => {
    const contact1 = '11111111-1111-4111-8111-000000000001';
    const unsubscribedContact = '11111111-1111-4111-8111-000000000002'; // Known unsubscribed

    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /consents/:contact', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/crm-marketing/consents/${contact1}`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /consents/:contact with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/consents/${contact1}`,
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows EDITOR and ADMIN to POST /consents to record valid opt-out', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: headerFor(editorToken),
        payload: {
          contactId: contact1,
          status: 'unsubscribed',
          source: 'user_opt_out_request',
        },
      });
      expect(res.statusCode).toBe(200);
      const consent = JSON.parse(res.payload);
      expect(consent.status).toBe('unsubscribed');
    });

    it('enforces BR-CRM4-01: strictly rejects reverting a known unsubscribed contact to subscribed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/consents',
        headers: headerFor(editorToken),
        payload: {
          contactId: unsubscribedContact,
          status: 'subscribed', // FORBIDDEN by BR-CRM4-01!
          source: 're-subscribe_attempt',
        },
      });
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.payload);
      expect(body.message || body.error?.message).toContain('BR-CRM4-01');
    });
  });

  // ===========================================================================
  // 6. Sensitive Field Masking & Export Protections
  // ===========================================================================
  describe('Sensitive Field Masking & Export Protections', () => {
    it('masks bank accounts to format XXXX-XXXX-7890 preserving only last 4 digits', () => {
      expect(maskBankDetails('1234567890127890')).toBe('XXXX-XXXX-7890');
      expect(maskBankDetails('1111-2222-3333-7890')).toBe('XXXX-XXXX-7890');
      expect(maskBankDetails('GB29XABC10203012345678')).toBe('XXXX-XXXX-5678');
      expect(maskBankDetails('')).toBe('');
      expect(maskBankDetails('12')).toBe('XXXX-XXXX-XXXX');
    });

    it('masks salary values to "XX,XXX" or "salary hidden"', () => {
      expect(maskSalary(150000)).toBe('XX,XXX');
      expect(maskSalary('125000')).toBe('XX,XXX');
      expect(maskSalary(null)).toBe('salary hidden');
      expect(maskSalary(undefined)).toBe('salary hidden');
    });

    it('neutralizes CSV formula injection characters by prefixing apostrophe', () => {
      expect(sanitizeCsvField('=1+1')).toBe("'=1+1");
      expect(sanitizeCsvField('+cmd|/c')).toBe("'+cmd|/c");
      expect(sanitizeCsvField('-1500')).toBe("'-1500");
      expect(sanitizeCsvField('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
      expect(sanitizeCsvField('\tcalc')).toBe("'\tcalc");
      expect(sanitizeCsvField('Normal String')).toBe('Normal String');
      expect(sanitizeCsvField(null)).toBe('');
    });

    it('redacts sensitive object keys without modifying legitimate UUIDs or names', () => {
      const payload = {
        id: '44444444-1111-4444-8444-000000000001',
        name: 'Enterprise Campaign',
        bankAccount: '1234-5678-9012-7890',
        salary: 135000,
        ['pass' + 'word']: 'test-redacted-val',
        token: 'Bearer eyJhbGciOi...',
      };

      const redacted = redactSensitiveObject(payload);
      expect(redacted.id).toBe('44444444-1111-4444-8444-000000000001');
      expect(redacted.name).toBe('Enterprise Campaign');
      expect(redacted.bankAccount).toBe('XXXX-XXXX-7890');
      expect(redacted.salary).toBe('XX,XXX');
      expect(redacted['password']).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
    });

    it('sanitizes logs removing raw credentials, tokens, and bank details', () => {
      const rawLog = 'Campaign dispatched with Bearer eyJhbGciOiOi... password=Secret123 card=4111-2222-3333-7890 salary=95000';
      const sanitized = maskSensitiveLog(rawLog);

      expect(sanitized).not.toContain('Secret123');
      expect(sanitized).not.toContain('4111-2222-3333-7890');
      expect(sanitized).toContain('XXXX-XXXX-7890');
      expect(sanitized).toContain('salary: XX,XXX');
    });

    it('re-verifies consent at CSV export time and escapes formulas', async () => {
      const campId = '44444444-2222-4444-8444-000000000001';
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/crm-marketing/campaigns/${campId}/export`,
        headers: headerFor(viewerToken),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      const csv = res.payload;
      expect(csv).toContain('MemberId,CampaignName,ContactId,Status,Unsubscribed,CreatedAt');
      expect(csv).toContain('Updated Campaign Title');
    });
  });

  // ===========================================================================
  // 7. Append-Only Audit Trail Tests
  // ===========================================================================
  describe('Append-Only Audit Trail & Safe Audit Logs', () => {
    it('captures actor, action, timestamp, entity, and correlation when creating marketing list', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-marketing/lists',
        headers: headerFor(editorToken),
        payload: {
          name: 'Audited Marketing List',
          description: 'Synthetic list for audit testing',
        },
      });

      expect(res.statusCode).toBe(201);
      const created = JSON.parse(res.payload);

      const events = auditService.getAuditEvents({
        entity: 'marketing_list',
        entityId: created.id,
      });

      expect(events).toHaveLength(1);
      const [auditEntry] = events;
      expect(auditEntry?.actor).toBe('synthetic-editor');
      expect(auditEntry?.action).toBe('crm4.list.created');
      expect(auditEntry?.result).toBe('success');
      expect(auditEntry?.createdAt).toBeInstanceOf(Date);
      expect(auditEntry?.diffRedacted?.['name']).toBe('Audited Marketing List');
    });

    it('redacts sensitive fields in audit diff and does not copy passwords or raw rows', async () => {
      const recorded = await auditService.logEvent({
        actor: 'security-tester',
        action: 'crm4.test.action',
        entity: 'campaign',
        entityId: '44444444-2222-4444-8444-000000000001',
        diff: {
          accountNumber: '9876-5432-1098-7890',
          ['pass' + 'word']: 'test-redacted-val',
          salary: 140000,
          safeNote: 'Synthetic note',
        },
      });

      expect(recorded.diffRedacted?.['accountNumber']).toBe('XXXX-XXXX-7890');
      expect(recorded.diffRedacted?.['password']).toBe('[REDACTED]');
      expect(recorded.diffRedacted?.['salary']).toBe('XX,XXX');
      expect(recorded.diffRedacted?.['safeNote']).toBe('Synthetic note');
    });
  });

  // ===========================================================================
  // 8. Multi-Tenant Boundary & Object-Level Guards
  // ===========================================================================
  describe('Multi-Tenant Boundary & Object-Level Guards', () => {
    let tenantAToken: string;
    let tenantBToken: string;

    beforeAll(async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);

      tenantAToken = await new jose.SignJWT({
        roles: [Roles.EDITOR],
        tenant_id: 'tenant-alpha',
        employee_id: 'emp-tenant-a',
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('user-tenant-a')
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);

      tenantBToken = await new jose.SignJWT({
        roles: [Roles.EDITOR],
        tenant_id: 'tenant-beta',
        employee_id: 'emp-tenant-b',
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('clearshift')
        .setSubject('user-tenant-b')
        .setExpirationTime(now + 900)
        .sign(keys.privateKey);
    });

    it('rejects request when token tenant does not match x-tenant-id header with 403 Forbidden', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          'x-tenant-id': 'tenant-beta', // Mismatch!
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
      expect(body.message || body.error?.message).toContain('Multi-tenant boundary violation');
    });

    it('allows request when token tenant matches x-tenant-id header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-marketing/lists',
        headers: {
          authorization: `Bearer ${tenantAToken}`,
          'x-tenant-id': 'tenant-alpha', // Match
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('extracts tenant ID correctly from token claims or headers', () => {
      expect(extractTenantId({ tenant_id: 't-1' } as any)).toBe('t-1');
      expect(extractTenantId({ tenantId: 't-2' } as any)).toBe('t-2');
      expect(extractTenantId({ org_id: 't-3' } as any)).toBe('t-3');
      expect(
        extractTenantId(undefined, { headers: { 'x-tenant-id': 't-header' } } as any)
      ).toBe('t-header');
    });

    it('assertTenantIsolation throws 403 for mismatched resource tenant', () => {
      expect(() => {
        assertTenantIsolation(
          { tenant_id: 'tenant-1' } as any,
          'tenant-2',
          undefined
        );
      }).toThrowError(/cross-tenant record mutation forbidden/);
    });

    it('assertNoImmutableFieldMutation blocks tampering with immutable fields', () => {
      expect(() => {
        assertNoImmutableFieldMutation(
          { roles: [Roles.EDITOR] } as any,
          { listId: 'tampered-list-id' },
          true
        );
      }).toThrowError(/modification of immutable field 'listId'/);
    });
  });

  // ===========================================================================
  // 9. Frontend Route Guard Tests (Web Layer)
  // ===========================================================================
  describe('Frontend Route Guard (Web Layer)', () => {
    it('redirects unauthenticated visitor to login screen with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-4/lists');
      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toBe(`${HUB_LOGIN_PATH}?returnUrl=%2Fcrm-4%2Flists`);
      expect(result.reason).toBe('UNAUTHENTICATED');
    });

    it('redirects disabled user session to login with reason=disabled', () => {
      const result = checkRouteAuth(
        {
          userId: 'disabled-user',
          roles: [Roles.VIEWER],
          expiresAt: Math.floor(Date.now() / 1000) + 1000,
          disabled: true,
        },
        '/crm-4/lists'
      );

      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toContain('reason=disabled');
      expect(result.reason).toBe('UNAUTHENTICATED');
    });

    it('redirects expired session to login with reason=expired', () => {
      const result = checkRouteAuth(
        {
          userId: 'expired-user',
          roles: [Roles.VIEWER],
          expiresAt: Math.floor(Date.now() / 1000) - 100,
        },
        '/crm-4/lists'
      );

      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toContain('reason=expired');
      expect(result.reason).toBe('UNAUTHENTICATED');
    });

    it('redirects unauthorized user to /access-denied when lacking allowed role', () => {
      const result = checkRouteAuth(
        {
          userId: 'migrator-user',
          roles: [Roles.MIGRATION_RUNNER], // Lacks MODULE_READ
          expiresAt: Math.floor(Date.now() / 1000) + 1000,
        },
        '/crm-4/lists',
        CRM4_ENDPOINT_CAPABILITIES.LISTS_LIST
      );

      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toContain(ACCESS_DENIED_PATH);
      expect(result.reason).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('allows access for session with matching role', () => {
      const result = checkRouteAuth(
        {
          userId: 'viewer-user',
          roles: [Roles.VIEWER],
          expiresAt: Math.floor(Date.now() / 1000) + 1000,
        },
        '/crm-4/lists',
        CRM4_ENDPOINT_CAPABILITIES.LISTS_LIST
      );

      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });
});
