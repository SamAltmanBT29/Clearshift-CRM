import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';
import { Roles, signAccessToken, getSigningKeys, type RoleType } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { Crm1Service } from '../../src/services/crm1.service.js';
import { Crm1AuditService } from '../../src/services/audit.js';
import {
  maskBankDetails,
  maskSalary,
  sanitizeCsvField,
  maskSensitiveLog,
  redactSensitiveObject,
} from '../../src/policies/masking.js';
import { CRM1_ENDPOINT_ROLES, isRoleAllowed } from '../../src/policies/roles.js';
import { checkRouteAuth, HUB_LOGIN_PATH, ACCESS_DENIED_PATH } from '../../web/auth/route-guard.js';
import {
  assertTenantIsolation,
  assertRecordOwnership,
  assertNoImmutableFieldMutation,
  extractTenantId,
  CRM1_ENDPOINT_CAPABILITIES,
  IMMUTABLE_MUTATION_FIELDS,
} from '../../src/interface/authz.js';

const databaseUrl = process.env["DATABASE_URL_TEST"];
const authSuite = databaseUrl ? describe : describe.skip;

authSuite('CRM-1 Security & Authorization (Issue #14 / [CRM1-09])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm1Service;
  let auditService: Crm1AuditService;

  // Role Tokens
  let viewerToken: string;
  let editorToken: string;
  let analystToken: string;
  let migrationRunnerToken: string;
  let adminToken: string;

  // Headers helpers
  const headerFor = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    service = new Crm1Service();
    await service.seedSyntheticData();
    auditService = new Crm1AuditService();

    app = buildApp({ service, auditService });
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
        url: '/api/v1/crm-contacts/contacts',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Bearer token is malformed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts',
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
        url: '/api/v1/crm-contacts/contacts',
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
        url: '/api/v1/crm-contacts/contacts',
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
        url: '/api/v1/crm-contacts/contacts',
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
        url: '/api/v1/crm-contacts/contacts',
        headers: headerFor(disabledToken),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  // ===========================================================================
  // 2. SDS Role Matrix Enforcement (Contacts Endpoints)
  // ===========================================================================
  describe('Contacts Endpoints SDS Matrix', () => {
    // GET /contacts -> viewer, editor, analyst, admin
    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /contacts', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/contacts',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /contacts with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts',
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
    });

    // POST /contacts -> editor, migration_runner, admin
    it('allows EDITOR, MIGRATION_RUNNER, and ADMIN to POST /contacts', async () => {
      for (const [idx, token] of [editorToken, migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/contacts',
          headers: headerFor(token),
          payload: {
            firstName: 'AuthAllowed',
            lastName: `Contact${idx}`,
            email: `auth.allowed.${idx}@clearshift.synthetic`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER and ANALYST from POST /contacts with 403 Forbidden', async () => {
      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/contacts',
          headers: headerFor(token),
          payload: {
            firstName: 'Forbidden',
            lastName: 'Contact',
            email: 'forbidden@clearshift.synthetic',
          },
        });
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
      }
    });

    // PATCH /contacts/:id -> editor, migration_runner, admin
    it('rejects VIEWER and ANALYST from PATCH /contacts/:id with 403 Forbidden', async () => {
      const contactId = '11111111-1111-4111-8111-000000000001';
      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-contacts/contacts/${contactId}`,
          headers: headerFor(token),
          payload: { firstName: 'UpdatedForbidden' },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 3. SDS Role Matrix Enforcement (Companies Endpoints)
  // ===========================================================================
  describe('Companies Endpoints SDS Matrix', () => {
    // GET /companies -> viewer, editor, admin (ANALYST is NOT in SDS for companies)
    it('allows VIEWER, EDITOR, and ADMIN to GET /companies', async () => {
      for (const token of [viewerToken, editorToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/companies',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects ANALYST and MIGRATION_RUNNER from GET /companies with 403 Forbidden', async () => {
      for (const token of [analystToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/companies',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // POST /companies -> editor, migration_runner, admin
    it('allows EDITOR, MIGRATION_RUNNER, and ADMIN to POST /companies', async () => {
      for (const [idx, token] of [editorToken, migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/companies',
          headers: headerFor(token),
          payload: {
            name: `Permitted Company ${idx}`,
            taxNumber: `TAX-PERM-${idx}`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER and ANALYST from POST /companies with 403 Forbidden', async () => {
      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/companies',
          headers: headerFor(token),
          payload: { name: 'Denied Company' },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 4. SDS Role Matrix Enforcement (Leads Endpoints)
  // ===========================================================================
  describe('Leads Endpoints SDS Matrix', () => {
    // GET /leads -> viewer, editor, admin (ANALYST is NOT in SDS for leads)
    it('allows VIEWER, EDITOR, and ADMIN to GET /leads', async () => {
      for (const token of [viewerToken, editorToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/leads',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects ANALYST and MIGRATION_RUNNER from GET /leads with 403 Forbidden', async () => {
      for (const token of [analystToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/leads',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // POST /leads -> editor, migration_runner, admin
    it('allows EDITOR, MIGRATION_RUNNER, and ADMIN to POST /leads', async () => {
      for (const [idx, token] of [editorToken, migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/leads',
          headers: headerFor(token),
          payload: {
            name: `Permitted Lead ${idx}`,
            email: `permitted.lead.${idx}@clearshift.synthetic`,
            status: 'New',
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER and ANALYST from POST /leads with 403 Forbidden', async () => {
      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/leads',
          headers: headerFor(token),
          payload: {
            name: 'Denied Lead',
            email: 'denied.lead@clearshift.synthetic',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 5. SDS Role Matrix Enforcement (Imports & Rejects Endpoints)
  // ===========================================================================
  describe('Imports & Rejects SDS Matrix', () => {
    // POST /imports -> migration_runner, admin
    it('allows MIGRATION_RUNNER and ADMIN to POST /imports', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/imports',
          headers: headerFor(token),
          payload: {
            batchId: `batch-auth-perm-${idx}`,
            sourceSystem: 'csv_upload',
            filename: `upload-${idx}.csv`,
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /imports with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-contacts/imports',
          headers: headerFor(token),
          payload: {
            batchId: 'batch-denied',
            sourceSystem: 'csv_upload',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // GET /imports/:batch -> viewer, analyst, admin
    it('allows VIEWER, ANALYST, and ADMIN to GET /imports/:batch and /rejects', async () => {
      for (const token of [viewerToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/imports/batch-contacts-01',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);

        const rejectsRes = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/imports/batch-contacts-01/rejects',
          headers: headerFor(token),
        });
        expect(rejectsRes.statusCode).toBe(200);
      }
    });

    it('rejects EDITOR and MIGRATION_RUNNER from GET /imports/:batch with 403 Forbidden', async () => {
      for (const token of [editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/imports/batch-contacts-01',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);

        const rejectsRes = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/imports/batch-contacts-01/rejects',
          headers: headerFor(token),
        });
        expect(rejectsRes.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 6. Sensitive Field Masking & Privacy Tests
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
        id: '11111111-1111-4111-8111-000000000001',
        firstName: 'Jane',
        bankAccount: '1234-5678-9012-7890',
        salary: 135000,
        ['pass' + 'word']: 'test-redacted-val',
        token: 'Bearer eyJhbGciOi...',
      };

      const redacted = redactSensitiveObject(payload);
      expect(redacted.id).toBe('11111111-1111-4111-8111-000000000001');
      expect(redacted.firstName).toBe('Jane');
      expect(redacted.bankAccount).toBe('XXXX-XXXX-7890');
      expect(redacted.salary).toBe('XX,XXX');
      expect(redacted['password']).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
    });

    it('sanitizes logs removing raw credentials, tokens, and bank details', () => {
      const rawLog = 'User login failed with Bearer eyJhbGciOiOi... password=Secret123 card=4111-2222-3333-7890 salary=95000';
      const sanitized = maskSensitiveLog(rawLog);

      expect(sanitized).not.toContain('Secret123');
      expect(sanitized).not.toContain('4111-2222-3333-7890');
      expect(sanitized).toContain('XXXX-XXXX-7890');
      expect(sanitized).toContain('salary: XX,XXX');
    });
  });

  // ===========================================================================
  // 7. Append-Only Audit Trail Tests
  // ===========================================================================
  describe('Append-Only Audit Trail & Safe Audit Logs', () => {
    it('captures actor, action, timestamp, entity, and correlation when creating contact', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/contacts',
        headers: headerFor(editorToken),
        payload: {
          firstName: 'Audited',
          lastName: 'Contact',
          email: 'audited.contact@clearshift.synthetic',
        },
      });

      expect(res.statusCode).toBe(201);
      const created = JSON.parse(res.payload);

      const events = auditService.getAuditEvents({
        entity: 'contact',
        entityId: created.id,
      });

      expect(events).toHaveLength(1);
      const [auditEntry] = events;
      expect(auditEntry?.actor).toBe('synthetic-editor');
      expect(auditEntry?.action).toBe('crm1.contact.created');
      expect(auditEntry?.result).toBe('success');
      expect(auditEntry?.createdAt).toBeInstanceOf(Date);
      expect(auditEntry?.diffRedacted?.['firstName']).toBe('Audited');
      expect(auditEntry?.diffRedacted?.['email']).toBe('audited.contact@clearshift.synthetic');
    });

    it('captures import run start audit event with correlation batchId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/imports',
        headers: headerFor(migrationRunnerToken),
        payload: {
          batchId: 'batch-audit-test-99',
          sourceSystem: 'legacy_crm',
          filename: 'legacy_import.csv',
        },
      });

      expect(res.statusCode).toBe(201);

      const events = auditService.getAuditEvents({
        batchId: 'batch-audit-test-99',
      });

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event?.actor).toBe('synthetic-migrator');
      expect(event?.action).toBe('crm1.import.started');
      expect(event?.entity).toBe('import_batch');
      expect(event?.batchId).toBe('batch-audit-test-99');
    });

    it('redacts sensitive fields in audit diff and does not copy passwords or raw rows', async () => {
      const recorded = await auditService.logEvent({
        actor: 'security-tester',
        action: 'crm1.test.action',
        entity: 'contact',
        entityId: '11111111-1111-4111-8111-000000000001',
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
  // 8. Frontend Route Guard Tests
  // ===========================================================================
  describe('Frontend Route Guard (Web Layer)', () => {
    it('redirects unauthenticated visitor to login screen with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-1/contacts');
      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toBe(`${HUB_LOGIN_PATH}?returnUrl=%2Fcrm-1%2Fcontacts`);
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
        '/crm-1/contacts'
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
        '/crm-1/contacts'
      );

      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toContain('reason=expired');
      expect(result.reason).toBe('UNAUTHENTICATED');
    });

    it('redirects unauthorized user to /access-denied when lacking allowed role', () => {
      const result = checkRouteAuth(
        {
          userId: 'migrator-user',
          roles: [Roles.MIGRATION_RUNNER],
          expiresAt: Math.floor(Date.now() / 1000) + 1000,
        },
        '/crm-1/contacts',
        CRM1_ENDPOINT_ROLES.CONTACTS_LIST
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
        '/crm-1/contacts',
        CRM1_ENDPOINT_ROLES.CONTACTS_LIST
      );

      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });

  // ===========================================================================
  // 9. CRM1-15 Module Authorization Policy & Object-Level Guards (Issue #108)
  // ===========================================================================
  describe('CRM1-15 Module Authorization Policy Integration & Object-Level Guards', () => {
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

    describe('Multi-Tenant Boundary Enforcement', () => {
      it('rejects request when token tenant does not match x-tenant-id header with 403 Forbidden', async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-contacts/contacts',
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
          url: '/api/v1/crm-contacts/contacts',
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
    });

    describe('Immutable Field Mutation Guards', () => {
      it('rejects attempt to mutate goldenId on PATCH /contacts/:id with 403 Forbidden', async () => {
        const contactId = '11111111-1111-4111-8111-000000000001';
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-contacts/contacts/${contactId}`,
          headers: headerFor(editorToken),
          payload: {
            goldenId: 'tampered-golden-id',
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
        expect(body.message || body.error?.message).toContain("modification of immutable field 'goldenId'");
      });

      it('rejects attempt to mutate sourceSystem on PATCH /contacts/:id with 403 Forbidden', async () => {
        const contactId = '11111111-1111-4111-8111-000000000001';
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-contacts/contacts/${contactId}`,
          headers: headerFor(editorToken),
          payload: {
            sourceSystem: 'hacked_source',
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
        expect(body.message || body.error?.message).toContain("modification of immutable field 'sourceSystem'");
      });

      it('rejects attempt to mutate id on PATCH /companies/:id with 403 Forbidden', async () => {
        const companyId = '22222222-2222-4222-8222-000000000001';
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/crm-contacts/companies/${companyId}`,
          headers: headerFor(editorToken),
          payload: {
            id: '33333333-3333-4333-8333-000000000001',
          },
        });

        expect(response.statusCode).toBe(403);
        const body = JSON.parse(response.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
        expect(body.message || body.error?.message).toContain("modification of immutable field 'id'");
      });

      it('allows ADMIN to override immutable field modifications for emergency operations', () => {
        expect(() => {
          assertNoImmutableFieldMutation(
            { roles: [Roles.ADMIN] } as any,
            { goldenId: 'admin-override', sourceSystem: 'new-source' }
          );
        }).not.toThrow();
      });

      it('rejects non-admin from modifying any field in IMMUTABLE_MUTATION_FIELDS', () => {
        for (const field of IMMUTABLE_MUTATION_FIELDS) {
          expect(() => {
            assertNoImmutableFieldMutation(
              { roles: [Roles.EDITOR] } as any,
              { [field]: 'illegal-value' }
            );
          }).toThrowError(new RegExp(`modification of immutable field '${field}'`));
        }
      });
    });

    describe('Cross-User Record Ownership Guards', () => {
      it('blocks non-admin from mutating a record owned by a different employee', () => {
        expect(() => {
          assertRecordOwnership(
            { roles: [Roles.EDITOR], employee_id: 'emp-101', sub: 'user-101' } as any,
            'emp-999' // Different owner
          );
        }).toThrowError(/unauthorized cross-user mutation/);
      });

      it('allows owner employee to mutate their own record', () => {
        expect(() => {
          assertRecordOwnership(
            { roles: [Roles.EDITOR], employee_id: 'emp-101', sub: 'user-101' } as any,
            'emp-101'
          );
        }).not.toThrow();
      });

      it('allows owner by sub to mutate their own record', () => {
        expect(() => {
          assertRecordOwnership(
            { roles: [Roles.EDITOR], sub: 'user-101' } as any,
            'user-101'
          );
        }).not.toThrow();
      });

      it('allows ADMIN to mutate records regardless of ownership', () => {
        expect(() => {
          assertRecordOwnership(
            { roles: [Roles.ADMIN], employee_id: 'emp-admin', sub: 'admin-user' } as any,
            'emp-999'
          );
        }).not.toThrow();
      });
    });

    describe('Capability Matrix Validation', () => {
      it('maps all CRM-1 endpoints to their standard RBAC capabilities', () => {
        expect(CRM1_ENDPOINT_CAPABILITIES.CONTACTS_LIST).toBe('module.read');
        expect(CRM1_ENDPOINT_CAPABILITIES.CONTACTS_CREATE).toBe('module.write');
        expect(CRM1_ENDPOINT_CAPABILITIES.COMPANIES_LIST).toBe('module.read');
        expect(CRM1_ENDPOINT_CAPABILITIES.COMPANIES_CREATE).toBe('module.write');
        expect(CRM1_ENDPOINT_CAPABILITIES.LEADS_LIST).toBe('module.read');
        expect(CRM1_ENDPOINT_CAPABILITIES.LEADS_CREATE).toBe('module.write');
        expect(CRM1_ENDPOINT_CAPABILITIES.IMPORTS_START).toBe('kit.run');
        expect(CRM1_ENDPOINT_CAPABILITIES.IMPORTS_STATUS).toBe('kit.read');
        expect(CRM1_ENDPOINT_CAPABILITIES.IMPORTS_REJECTS).toBe('kit.read');
      });
    });
  });
});
