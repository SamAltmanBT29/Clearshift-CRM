import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';
import { Roles, signAccessToken, getSigningKeys, type RoleType } from '@cs/identity';
import { Capabilities, hasCapability } from '@cs/rbac';
import {
  CRM2_API_PREFIX,
  CRM2_STAGES,
  CRM2_STAGE_SEEDS,
  assertValidStageName,
  isDealStageTransitionAllowed,
} from '@clearshift/contracts';
import { buildApp } from '../../src/app.js';
import { Crm2Service } from '../../src/services/crm2.service.js';
import { Crm2AuditService } from '../../src/services/audit.js';
import {
  maskBankDetails,
  maskSalary,
  sanitizeCsvField,
  maskSensitiveLog,
  redactSensitiveObject,
} from '../../src/policies/masking.js';
import {
  CRM2_ENDPOINT_ROLES,
  CRM2_ENDPOINT_CAPABILITIES,
  isRoleAllowed,
  isCapabilityAllowed,
} from '../../src/policies/roles.js';
import {
  assertTenantIsolation,
  assertRecordOwnership,
  type AuthenticatedUser,
} from '../../src/plugins/auth.js';
import {
  extractTenantId,
  assertNoImmutableFieldMutation,
  assertObjectMutationAllowed,
  createEndpointAuthPreHandlers,
  IMMUTABLE_MUTATION_FIELDS,
  IMMUTABLE_CREATION_FIELDS,
  type Crm2TokenClaims,
  type ObjectAuthorizationContext,
} from '../../src/interface/authz.js';
import { checkRouteAuth, HUB_LOGIN_PATH, ACCESS_DENIED_PATH } from '../../web/src/auth/route-guard.js';

describe('CRM-2 Security & Authorization Policy Integration (Issues #128, #24 / [CRM2-15, CRM2-09])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: Crm2Service;
  let auditService: Crm2AuditService;

  // Role Tokens
  let viewerToken: string;
  let editorToken: string;
  let analystToken: string;
  let migrationRunnerToken: string;
  let adminToken: string;
  let tenantAlphaViewerToken: string;
  let tenantAlphaEditorToken: string;
  let tenantAlphaMigratorToken: string;

  const headerFor = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    service = new Crm2Service();
    auditService = new Crm2AuditService();

    app = buildApp({
      service,
      auditService,
      enforceAuth: true,
      authEnabled: true,
    });
    await app.ready();

    viewerToken = await signAccessToken('synthetic-viewer', [Roles.VIEWER]);
    editorToken = await signAccessToken('synthetic-editor', [Roles.EDITOR]);
    analystToken = await signAccessToken('synthetic-analyst', [Roles.ANALYST]);
    migrationRunnerToken = await signAccessToken('synthetic-migrator', [Roles.MIGRATION_RUNNER]);
    adminToken = await signAccessToken('synthetic-admin', [Roles.ADMIN]);

    const keys = await getSigningKeys();
    const now = Math.floor(Date.now() / 1000);

    tenantAlphaViewerToken = await new jose.SignJWT({
      roles: [Roles.VIEWER],
      sub: 'tenant-viewer-sub',
      employee_id: 'emp-viewer-1',
      tenant_id: 'tenant-alpha',
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
      .setIssuer('clearshift-hub')
      .setAudience('clearshift')
      .setExpirationTime(now + 3600)
      .sign(keys.privateKey);

    tenantAlphaEditorToken = await new jose.SignJWT({
      roles: [Roles.EDITOR],
      sub: 'tenant-editor-sub',
      employee_id: 'emp-editor-1',
      tenant_id: 'tenant-alpha',
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
      .setIssuer('clearshift-hub')
      .setAudience('clearshift')
      .setExpirationTime(now + 3600)
      .sign(keys.privateKey);

    tenantAlphaMigratorToken = await new jose.SignJWT({
      roles: [Roles.MIGRATION_RUNNER],
      sub: 'tenant-migrator-sub',
      employee_id: 'emp-migrator-1',
      tenant_id: 'tenant-alpha',
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
      .setIssuer('clearshift-hub')
      .setAudience('clearshift')
      .setExpirationTime(now + 3600)
      .sign(keys.privateKey);
  });

  beforeEach(() => {
    service.resetStore();
    auditService.resetLedger();
  });

  // ===========================================================================
  // 1. Unauthenticated & Invalid JWT Tests (401 Unauthorized)
  // ===========================================================================
  describe('Unauthenticated & Invalid Token Handling (401 Unauthorized)', () => {
    it('allows unauthenticated requests to public /health probe', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/health`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
      expect(body.module).toBe('crm-2');
    });

    it('returns 401 when Authorization header is completely missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
      expect(body.correlation_id).toBeDefined();
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Bearer token is malformed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: { authorization: 'Bearer invalid.jwt.payload' },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
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
        url: `${CRM2_API_PREFIX}/deals`,
        headers: headerFor(expiredToken),
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token issuer is invalid', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const badIssuerToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('malicious-issuer')
        .setAudience('clearshift')
        .setSubject('attacker')
        .setExpirationTime(now + 3600)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: headerFor(badIssuerToken),
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token audience is invalid', async () => {
      const keys = await getSigningKeys();
      const now = Math.floor(Date.now() / 1000);
      const badAudienceToken = await new jose.SignJWT({ roles: [Roles.ADMIN] })
        .setProtectedHeader({ alg: 'EdDSA', kid: 'cs-hub-key-v1' })
        .setIssuer('clearshift-hub')
        .setAudience('external-service')
        .setSubject('wrong-audience')
        .setExpirationTime(now + 3600)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: headerFor(badAudienceToken),
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
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
        .setSubject('disabled-admin')
        .setExpirationTime(now + 3600)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: headerFor(disabledToken),
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
      expect(body.message).toContain('disabled');
    });
  });

  // ===========================================================================
  // 2. Deals Endpoints SDS Matrix
  // ===========================================================================
  describe('Deals Endpoints SDS Matrix', () => {
    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /deals', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/deals`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /deals with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
    });

    it('allows EDITOR, MIGRATION_RUNNER, and ADMIN to POST /deals', async () => {
      for (const [idx, token] of [editorToken, migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/deals`,
          headers: headerFor(token),
          payload: {
            name: `Permitted Deal ${idx}`,
            value: '50000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-31',
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER and ANALYST from POST /deals with 403 Forbidden', async () => {
      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/deals`,
          headers: headerFor(token),
          payload: {
            name: 'Forbidden Deal',
            value: '10000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-31',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('rejects VIEWER and ANALYST from PATCH /deals/:id with 403 Forbidden', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Update Test',
        value: '20000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      });

      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'PATCH',
          url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
          headers: headerFor(token),
          payload: {
            name: 'Attempted Unauthorized Update',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('allows EDITOR, MIGRATION_RUNNER, and ADMIN to PATCH /deals/:id', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Valid Update',
        value: '30000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      });

      for (const [idx, token] of [editorToken, migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'PATCH',
          url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
          headers: headerFor(token),
          payload: {
            name: `Updated Deal Title ${idx}`,
          },
        });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  // ===========================================================================
  // 3. Stages Endpoints SDS Matrix
  // ===========================================================================
  describe('Stages Endpoints SDS Matrix', () => {
    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /stages', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/stages`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.items).toHaveLength(6);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /stages with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/stages`,
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ===========================================================================
  // 4. Quotes Endpoints SDS Matrix
  // ===========================================================================
  describe('Quotes Endpoints SDS Matrix', () => {
    it('allows VIEWER, EDITOR, ANALYST, and ADMIN to GET /quotes', async () => {
      for (const token of [viewerToken, editorToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/quotes`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects MIGRATION_RUNNER from GET /quotes with 403 Forbidden', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: headerFor(migrationRunnerToken),
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows EDITOR, MIGRATION_RUNNER, and ADMIN to POST /quotes', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Quotes Auth Test',
        value: '40000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-12-31',
      });

      for (const [idx, token] of [editorToken, migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/quotes`,
          headers: headerFor(token),
          payload: {
            quote_number: `Q-AUTH-${idx}-001`,
            deal_id: deal.id,
            amount: '15000.00',
            currency: 'USD',
            date: '2026-11-20',
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER and ANALYST from POST /quotes with 403 Forbidden', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Quotes Denied Test',
        value: '40000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-12-31',
      });

      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/quotes`,
          headers: headerFor(token),
          payload: {
            quote_number: 'Q-DENIED-001',
            deal_id: deal.id,
            amount: '10000.00',
            currency: 'USD',
            date: '2026-11-20',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('rejects VIEWER and ANALYST from PATCH /quotes/:id with 403 Forbidden', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Quote Patch Auth',
        value: '30000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-12-31',
      });
      const quote = await service.createQuote({
        quote_number: 'Q-FOR-PATCH-001',
        deal_id: deal.id,
        amount: '12000.00',
        currency: 'USD',
        date: '2026-11-20',
      });

      for (const token of [viewerToken, analystToken]) {
        const res = await app.inject({
          method: 'PATCH',
          url: `${CRM2_API_PREFIX}/quotes/${quote.id}`,
          headers: headerFor(token),
          payload: {
            amount: '18000.00',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 5. Ingestion, Batches & Duplicates SDS Matrix
  // ===========================================================================
  describe('Ingestion, Batches & Duplicates SDS Matrix', () => {
    it('allows MIGRATION_RUNNER and ADMIN to POST /import', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/import`,
          headers: {
            ...headerFor(token),
            'idempotency-key': `idemp-import-auth-${idx}`,
          },
          payload: {
            batchId: `batch-auth-${idx}`,
            sourceRow: 1,
            sourceSystem: 'kit_crm2',
            sourceId: `src-${idx}`,
            entity: 'deal',
            data: {
              name: `Imported Deal ${idx}`,
              value: '10000.00',
              currency: 'USD',
              stage_name: 'New',
              close_date: '2026-12-31',
            },
          },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /import with 403 Forbidden', async () => {
      for (const [idx, token] of [viewerToken, editorToken, analystToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/import`,
          headers: {
            ...headerFor(token),
            'idempotency-key': `idemp-import-denied-${idx}`,
          },
          payload: {
            batchId: 'batch-denied',
            sourceRow: 1,
            sourceSystem: 'kit_crm2',
            sourceId: 'src-denied',
            entity: 'deal',
            data: { name: 'Denied Deal' },
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('allows MIGRATION_RUNNER and ADMIN to POST /batches/execute-load', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/batches/execute-load`,
          headers: headerFor(token),
          payload: {
            batchId: `batch-exec-auth-${idx}`,
            records: [
              {
                sourceRow: 1,
                idempotencyKey: `idemp-batch-exec-${idx}`,
                data: {
                  name: `Batch Deal ${idx}`,
                  value: '25000.00',
                  currency: 'USD',
                  stage_name: 'New',
                  close_date: '2026-12-31',
                },
              },
            ],
          },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /batches/execute-load with 403', async () => {
      for (const token of [viewerToken, editorToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/batches/execute-load`,
          headers: headerFor(token),
          payload: {
            batchId: 'batch-exec-denied',
            records: [
              {
                sourceRow: 1,
                idempotencyKey: 'idemp-denied-load',
                data: { name: 'Forbidden Deal' },
              },
            ],
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('allows VIEWER, ANALYST, and ADMIN to GET /import/receipts', async () => {
      for (const token of [viewerToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/import/receipts`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects EDITOR and MIGRATION_RUNNER from GET /import/receipts with 403', async () => {
      for (const token of [editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/import/receipts`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('allows ANALYST, MIGRATION_RUNNER, and ADMIN to POST /duplicates/detect', async () => {
      for (const token of [analystToken, migrationRunnerToken, adminToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/duplicates/detect`,
          headers: headerFor(token),
          payload: {
            batchId: 'batch-dup-auth-1',
            keyType: 'deal_business',
            records: [
              { id: '11111111-1111-4000-8000-000000000001', keyValue: 'acme_cloud' },
            ],
          },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER and EDITOR from POST /duplicates/detect with 403', async () => {
      for (const token of [viewerToken, editorToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/duplicates/detect`,
          headers: headerFor(token),
          payload: {
            batchId: 'batch-dup-denied',
            keyType: 'deal_business',
            records: [],
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('rejects VIEWER and MIGRATION_RUNNER from POST /duplicates/resolve with 403', async () => {
      for (const token of [viewerToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'POST',
          url: `${CRM2_API_PREFIX}/duplicates/resolve`,
          headers: headerFor(token),
          payload: {
            candidateId: 'cand-1',
            decision: 'MERGE',
            actorId: 'user-1',
            keptId: '22222222-2222-4000-8000-000000000001',
            mergedId: '22222222-2222-4000-8000-000000000002',
            reason: 'Duplicate deal consolidated',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    it('allows VIEWER, ANALYST, and ADMIN to GET /duplicates/audit', async () => {
      for (const token of [viewerToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/duplicates/audit`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects EDITOR and MIGRATION_RUNNER from GET /duplicates/audit with 403', async () => {
      for (const token of [editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: `${CRM2_API_PREFIX}/duplicates/audit`,
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 6. Sensitive Field Masking & Export Protections
  // ===========================================================================
  describe('Sensitive Field Masking & Export Protections', () => {
    it('masks bank accounts to format XXXX-XXXX-7890 preserving only last 4 digits', () => {
      expect(maskBankDetails('1234567890123456')).toBe('XXXX-XXXX-3456');
      expect(maskBankDetails('GB29XABC10203012345678')).toBe('XXXX-XXXX-5678');
      expect(maskBankDetails('1234')).toBe('XXXX-XXXX-1234');
      expect(maskBankDetails('99')).toBe('XXXX-XXXX-XXXX');
      expect(maskBankDetails('')).toBe('');
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
      expect(sanitizeCsvField('  =cmd')).toBe("'  =cmd");
      expect(sanitizeCsvField('Normal String')).toBe('Normal String');
      expect(sanitizeCsvField(null)).toBe('');
    });

    it('redacts sensitive object keys without modifying legitimate UUIDs or names', () => {
      const payload = {
        id: '11111111-1111-4111-8111-000000000001',
        name: 'Enterprise Tech Renewal',
        bank_account: '9876543210987654',
        salary: 145000,
        token: 'secret-auth-bearer-token',
        nested: {
          account_number: '1111222233334444',
          compensation: '200000',
        },
      };

      const redacted = redactSensitiveObject(payload);

      expect(redacted.id).toBe('11111111-1111-4111-8111-000000000001');
      expect(redacted.name).toBe('Enterprise Tech Renewal');
      expect(redacted.bank_account).toBe('XXXX-XXXX-7654');
      expect(redacted.salary).toBe('XX,XXX');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.nested.account_number).toBe('XXXX-XXXX-4444');
      expect(redacted.nested.compensation).toBe('XX,XXX');
    });

    it('sanitizes logs removing raw credentials, tokens, and bank details', () => {
      const log1 = 'Authentication failed with Bearer secret-user-token-12345';
      expect(maskSensitiveLog(log1)).toContain('[REDACTED_TOKEN]');

      const log2 = 'Processing customer card 1234-5678-9012-3456 in gateway';
      expect(maskSensitiveLog(log2)).toContain('XXXX-XXXX-3456');

      const log3 = 'Employee salary: 150000 updated';
      expect(maskSensitiveLog(log3)).toContain('salary: XX,XXX');
    });
  });

  // ===========================================================================
  // 7. Append-Only Audit Trail & Safe Audit Logs
  // ===========================================================================
  describe('Append-Only Audit Trail & Safe Audit Logs', () => {
    it('captures actor, action, timestamp, entity, and correlation when creating deal', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: headerFor(editorToken),
        payload: {
          name: 'Audited Deal Create',
          value: '80000.00',
          currency: 'USD',
          stage_name: 'Proposal',
          close_date: '2026-12-15',
        },
      });

      expect(res.statusCode).toBe(201);
      const deal = res.json();

      const events = auditService.getAuditEvents({
        entity: 'deal',
        action: 'crm2.deal.created',
      });
      expect(events.length).toBeGreaterThanOrEqual(1);

      const latest = events[events.length - 1]!;
      expect(latest.actor).toBe('synthetic-editor');
      expect(latest.entityId).toBe(deal.id);
      expect(latest.result).toBe('success');
      expect(latest.diffRedacted).toBeDefined();
    });

    it('captures deal update audit event', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Audit Update',
        value: '50000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `${CRM2_API_PREFIX}/deals/${deal.id}`,
        headers: headerFor(editorToken),
        payload: {
          name: 'Audited Deal Renamed',
        },
      });

      expect(res.statusCode).toBe(200);

      const events = auditService.getAuditEvents({
        entity: 'deal',
        action: 'crm2.deal.updated',
        entityId: deal.id,
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.actor).toBe('synthetic-editor');
      expect(events[0]?.result).toBe('success');
    });

    it('captures quote creation audit event', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Quote Audit',
        value: '60000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-12-31',
      });

      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/quotes`,
        headers: headerFor(editorToken),
        payload: {
          quote_number: 'Q-AUDIT-101',
          deal_id: deal.id,
          amount: '20000.00',
          currency: 'USD',
          date: '2026-11-25',
        },
      });

      expect(res.statusCode).toBe(201);
      const quote = res.json();

      const events = auditService.getAuditEvents({
        entity: 'quote',
        action: 'crm2.quote.created',
        entityId: quote.id,
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.result).toBe('success');
    });

    it('captures import row and batch load audit events with correlation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `${CRM2_API_PREFIX}/import`,
        headers: {
          ...headerFor(migrationRunnerToken),
          'idempotency-key': 'idemp-audit-batch-001',
        },
        payload: {
          batchId: 'batch-audit-crm2-99',
          sourceRow: 1,
          sourceSystem: 'kit_crm2',
          sourceId: 'src-row-1',
          entity: 'deal',
          data: {
            name: 'Audited Import Deal',
            value: '75000.00',
            currency: 'USD',
            stage_name: 'New',
            close_date: '2026-12-31',
          },
        },
      });

      expect(res.statusCode).toBe(201);

      const events = auditService.getAuditEvents({
        entity: 'crm2_import',
        action: 'crm2.import.row_loaded',
        batchId: 'batch-audit-crm2-99',
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.actor).toBe('synthetic-migrator');
      expect(events[0]?.result).toBe('success');
    });

    it('redacts sensitive fields in audit diff and does not copy passwords or raw rows', async () => {
      await auditService.logEvent({
        actor: 'user-sec-officer',
        action: 'crm2.deal.salary_review',
        entity: 'deal',
        entityId: '33333333-3333-4000-8000-000000000001',
        diff: {
          dealName: 'Executive Retainer Deal',
          bank_account: '9876543210987654',
          salary: 220000,
          token: 'sensitive-bearer-token',
        },
      });

      const events = auditService.getAuditEvents({
        action: 'crm2.deal.salary_review',
      });
      expect(events).toHaveLength(1);

      const diff = events[0]?.diffRedacted as Record<string, unknown>;
      expect(diff.bank_account).toBe('XXXX-XXXX-7654');
      expect(diff.salary).toBe('XX,XXX');
      expect(diff.token).toBe('[REDACTED]');
      expect(diff.dealName).toBe('Executive Retainer Deal');
    });
  });

  // ===========================================================================
  // 8. Domain Invariant Assertions
  // ===========================================================================
  describe('Domain Invariants for CRM-2 Deals, Pipeline and Quotes', () => {
    it('Stage set is exactly New, Qualified, Proposal, Negotiation, Won, Lost', () => {
      expect(CRM2_STAGES).toEqual(['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
      expect(CRM2_STAGES).toHaveLength(6);

      for (const stage of CRM2_STAGES) {
        expect(() => assertValidStageName(stage)).not.toThrow();
      }

      expect(() => assertValidStageName('ClosedWon')).toThrow();
      expect(() => assertValidStageName('Draft')).toThrow();
      expect(() => assertValidStageName('Pending')).toThrow();
    });

    it('Stage records are seeded and cannot be renamed or duplicated', () => {
      expect(CRM2_STAGE_SEEDS).toHaveLength(6);
      expect(CRM2_STAGE_SEEDS.map((s) => s.name)).toEqual(CRM2_STAGES);
      expect(CRM2_STAGE_SEEDS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6]);

      const won = CRM2_STAGE_SEEDS.find((s) => s.name === 'Won');
      expect(won?.is_closed_won).toBe(true);
      expect(won?.is_closed_lost).toBe(false);

      const lost = CRM2_STAGE_SEEDS.find((s) => s.name === 'Lost');
      expect(lost?.is_closed_lost).toBe(true);
      expect(lost?.is_closed_won).toBe(false);
    });

    it('enforces deal stage lifecycle transitions according to the contract', () => {
      expect(isDealStageTransitionAllowed('New', 'Qualified')).toBe(true);
      expect(isDealStageTransitionAllowed('Qualified', 'Proposal')).toBe(true);
      expect(isDealStageTransitionAllowed('Proposal', 'Negotiation')).toBe(true);
      expect(isDealStageTransitionAllowed('Negotiation', 'Won')).toBe(true);

      // Immediate to Lost allowed
      expect(isDealStageTransitionAllowed('New', 'Lost')).toBe(true);
      expect(isDealStageTransitionAllowed('Qualified', 'Lost')).toBe(true);
      expect(isDealStageTransitionAllowed('Proposal', 'Lost')).toBe(true);

      // Terminal stage transitions forbidden
      expect(isDealStageTransitionAllowed('Won', 'Negotiation')).toBe(false);
      expect(isDealStageTransitionAllowed('Lost', 'New')).toBe(false);
    });

    it('nullable contact_id represents orphan deals and flags them visibly', async () => {
      const orphanDeal = await service.createDeal({
        name: 'Orphan Deal',
        contact_id: null,
        value: '10000.00',
        currency: 'USD',
        stage_name: 'New',
        close_date: '2026-12-31',
      });

      expect(orphanDeal.contact_id).toBeNull();
      expect(orphanDeal.is_orphan).toBe(true);

      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals/${orphanDeal.id}`,
        headers: headerFor(viewerToken),
      });

      expect(res.statusCode).toBe(200);
      const fetched = res.json();
      expect(fetched.is_orphan).toBe(true);
      expect(fetched.contact_id).toBeNull();
    });

    it('enforces quote number uniqueness', async () => {
      const deal = await service.createDeal({
        name: 'Deal For Unique Quote Test',
        value: '50000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-12-31',
      });

      await service.createQuote({
        quote_number: 'Q-UNIQUE-001',
        deal_id: deal.id,
        amount: '10000.00',
        currency: 'USD',
        date: '2026-11-20',
      });

      await expect(
        service.createQuote({
          quote_number: 'Q-UNIQUE-001',
          deal_id: deal.id,
          amount: '12000.00',
          currency: 'USD',
          date: '2026-11-21',
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // 9. Multi-Tenant Boundary Isolation Guards
  // ===========================================================================
  describe('Multi-Tenant Boundary Isolation Guards', () => {
    it('allows requests when request header x-tenant-id matches user token tenant_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: {
          ...headerFor(tenantAlphaViewerToken),
          'x-tenant-id': 'tenant-alpha',
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects requests with 403 Forbidden when x-tenant-id does not match token tenant_id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `${CRM2_API_PREFIX}/deals`,
        headers: {
          ...headerFor(tenantAlphaViewerToken),
          'x-tenant-id': 'tenant-bravo', // Mismatched tenant
        },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code || body.error?.code).toBe('FORBIDDEN');
      expect(body.message).toContain('Multi-tenant boundary violation');
    });

    it('assertTenantIsolation throws 403 on tenant header mismatch', () => {
      const user: AuthenticatedUser = {
        sub: 'user-1',
        roles: [Roles.VIEWER],
        tenant_id: 'tenant-1',
      };
      const mockReq = {
        headers: { 'x-tenant-id': 'tenant-2' },
      } as any;

      expect(() => assertTenantIsolation(user, undefined, mockReq)).toThrow();
    });

    it('assertTenantIsolation throws 403 on resource tenant mismatch', () => {
      const user: AuthenticatedUser = {
        sub: 'user-1',
        roles: [Roles.VIEWER],
        tenant_id: 'tenant-1',
      };
      expect(() => assertTenantIsolation(user, 'tenant-2')).toThrow();
    });

    it('assertTenantIsolation succeeds when tenant matches', () => {
      const user: AuthenticatedUser = {
        sub: 'user-1',
        roles: [Roles.VIEWER],
        tenant_id: 'tenant-1',
      };
      const mockReq = {
        headers: { 'x-tenant-id': 'tenant-1' },
      } as any;

      expect(() => assertTenantIsolation(user, 'tenant-1', mockReq)).not.toThrow();
    });
  });

  // ===========================================================================
  // 10. Object-Level Cross-User Mutation Prevention
  // ===========================================================================
  describe('Object-Level Cross-User Mutation Prevention', () => {
    it('assertRecordOwnership throws 403 when non-admin caller does not match owner', () => {
      const user: AuthenticatedUser = {
        sub: 'user-alpha',
        employee_id: 'emp-101',
        roles: [Roles.EDITOR],
      };
      expect(() => assertRecordOwnership(user, 'emp-102')).toThrow();
    });

    it('assertRecordOwnership allows non-admin caller when employee_id matches owner', () => {
      const user: AuthenticatedUser = {
        sub: 'user-alpha',
        employee_id: 'emp-101',
        roles: [Roles.EDITOR],
      };
      expect(() => assertRecordOwnership(user, 'emp-101')).not.toThrow();
    });

    it('assertRecordOwnership allows non-admin caller when sub matches owner', () => {
      const user: AuthenticatedUser = {
        sub: 'emp-202',
        roles: [Roles.EDITOR],
      };
      expect(() => assertRecordOwnership(user, 'emp-202')).not.toThrow();
    });

    it('assertRecordOwnership always permits ADMIN role (universal administrative override)', () => {
      const adminUser: AuthenticatedUser = {
        sub: 'admin-sub',
        employee_id: 'emp-admin',
        roles: [Roles.ADMIN],
      };
      expect(() => assertRecordOwnership(adminUser, 'emp-any-user')).not.toThrow();
    });
  });

  // ===========================================================================
  // 11. Frontend Route Guard (Web Layer)
  // ===========================================================================
  describe('Frontend Route Guard (Web Layer)', () => {
    const targetPath = '/deals/pipeline';

    it('redirects unauthenticated visitor to login screen with returnUrl', () => {
      const result = checkRouteAuth(null, targetPath);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toBe(`${HUB_LOGIN_PATH}?returnUrl=${encodeURIComponent(targetPath)}`);
    });

    it('redirects disabled user session to login with reason=disabled', () => {
      const session = {
        userId: 'user-dis-1',
        roles: [Roles.ADMIN],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        disabled: true,
      };

      const result = checkRouteAuth(session, targetPath);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toContain('reason=disabled');
    });

    it('redirects expired session to login with reason=expired', () => {
      const session = {
        userId: 'user-exp-1',
        roles: [Roles.ADMIN],
        expiresAt: Math.floor(Date.now() / 1000) - 60, // expired 1 minute ago
      };

      const result = checkRouteAuth(session, targetPath);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('UNAUTHENTICATED');
      expect(result.redirectTo).toContain('reason=expired');
    });

    it('redirects unauthorized user to /access-denied when lacking allowed role', () => {
      const session = {
        userId: 'user-viewer-1',
        roles: [Roles.VIEWER],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const result = checkRouteAuth(session, '/deals/new', [Roles.EDITOR, Roles.ADMIN]);
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toBe('INSUFFICIENT_PERMISSIONS');
      expect(result.redirectTo).toContain(ACCESS_DENIED_PATH);
    });

    it('allows access for session with matching role', () => {
      const session = {
        userId: 'user-editor-1',
        roles: [Roles.EDITOR],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

      const result = checkRouteAuth(session, '/deals/new', [Roles.EDITOR, Roles.ADMIN]);
      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });

  // ===========================================================================
  // 12. RBAC Capability Matrix Integration (@cs/rbac)
  // ===========================================================================
  describe('RBAC Capability Matrix Integration (@cs/rbac)', () => {
    it('verifies VIEWER role has MODULE_READ capability and can read deals', () => {
      expect(hasCapability([Roles.VIEWER], Capabilities.MODULE_READ)).toBe(true);
      expect(isCapabilityAllowed([Roles.VIEWER], 'DEALS_LIST')).toBe(true);
      expect(isCapabilityAllowed([Roles.VIEWER], 'DEALS_CREATE')).toBe(false);
    });

    it('verifies EDITOR role has MODULE_WRITE capability for deal mutations', () => {
      expect(hasCapability([Roles.EDITOR], Capabilities.MODULE_WRITE)).toBe(true);
      expect(isCapabilityAllowed([Roles.EDITOR], 'DEALS_CREATE')).toBe(true);
      expect(isCapabilityAllowed([Roles.EDITOR], 'DEALS_UPDATE')).toBe(true);
    });

    it('verifies MIGRATION_RUNNER role has KIT_RUN capability for pipeline ingestion', () => {
      expect(hasCapability([Roles.MIGRATION_RUNNER], Capabilities.KIT_RUN)).toBe(true);
      expect(isCapabilityAllowed([Roles.MIGRATION_RUNNER], 'IMPORT_WRITE')).toBe(true);
    });

    it('verifies ANALYST role has MODULE_READ and CONTROL_READ capabilities', () => {
      expect(hasCapability([Roles.ANALYST], Capabilities.MODULE_READ)).toBe(true);
      expect(hasCapability([Roles.ANALYST], Capabilities.CONTROL_READ)).toBe(true);
      expect(isCapabilityAllowed([Roles.ANALYST], 'DUPLICATES_DETECT')).toBe(true);
    });

    it('verifies ADMIN role has universal capability access across all CRM-2 endpoints', () => {
      for (const endpointKey of Object.keys(CRM2_ENDPOINT_ROLES) as (keyof typeof CRM2_ENDPOINT_ROLES)[]) {
        expect(isCapabilityAllowed([Roles.ADMIN], endpointKey)).toBe(true);
      }
    });
  });

  // ===========================================================================
  // 13. Object-Level Authorization & Immutable Field Controls (CRM2-15 / #128)
  // ===========================================================================
  describe('Object-Level Authorization & Immutable Field Controls (CRM2-15 / #128)', () => {
    it('extracts normalized tenant ID from token claims or request headers', () => {
      const userWithTenant: Crm2TokenClaims = {
        sub: 'usr-1',
        roles: [Roles.EDITOR],
        tenant_id: 'tenant-omega',
      };
      expect(extractTenantId(userWithTenant)).toBe('tenant-omega');

      const userWithOrgId: Crm2TokenClaims = {
        sub: 'usr-2',
        roles: [Roles.VIEWER],
        org_id: 'org-123',
      };
      expect(extractTenantId(userWithOrgId)).toBe('org-123');

      const mockRequest = {
        headers: { 'x-tenant-id': 'tenant-header-val' },
      } as any;
      expect(extractTenantId(undefined, mockRequest)).toBe('tenant-header-val');
    });

    it('rejects mutation of immutable fields (id, quoteNumber, createdAt, updatedAt) for non-admin users', () => {
      const editorUser: Crm2TokenClaims = {
        sub: 'editor-1',
        roles: [Roles.EDITOR],
      };

      for (const field of IMMUTABLE_MUTATION_FIELDS) {
        expect(() => {
          assertNoImmutableFieldMutation(editorUser, { [field]: 'tampered-value', name: 'Valid Name' }, true);
        }).toThrow(/modification of immutable field/);
      }
    });

    it('allows non-admin mutations when only mutable fields are updated', () => {
      const editorUser: Crm2TokenClaims = {
        sub: 'editor-1',
        roles: [Roles.EDITOR],
      };

      expect(() => {
        assertNoImmutableFieldMutation(
          editorUser,
          {
            name: 'Updated Deal Name',
            value: '75000.00',
            stage_name: 'Proposal',
          },
          true
        );
      }).not.toThrow();
    });

    it('allows ADMIN role to bypass immutable field restriction for emergency data correction', () => {
      const adminUser: Crm2TokenClaims = {
        sub: 'admin-1',
        roles: [Roles.ADMIN],
      };

      expect(() => {
        assertNoImmutableFieldMutation(
          adminUser,
          {
            id: 'forced-id-correction',
            quoteNumber: 'Q-9999',
            updatedAt: '2026-10-24T00:00:00Z',
          },
          true
        );
      }).not.toThrow();
    });

    it('blocks non-admin users from forging golden identity fields on record creation', () => {
      const editorUser: Crm2TokenClaims = {
        sub: 'editor-1',
        roles: [Roles.EDITOR],
      };

      for (const field of IMMUTABLE_CREATION_FIELDS) {
        expect(() => {
          assertNoImmutableFieldMutation(editorUser, { [field]: 'forged-golden-id' }, false);
        }).toThrow(/modification of immutable field/);
      }
    });

    it('assertObjectMutationAllowed enforces tenant, ownership, and immutability comprehensively', () => {
      const user: Crm2TokenClaims = {
        sub: 'emp-001',
        employee_id: 'emp-001',
        roles: [Roles.EDITOR],
        tenant_id: 'tenant-corp',
      };

      const validCtx: ObjectAuthorizationContext = {
        resourceType: 'deal',
        resourceId: 'deal-101',
        resourceOwnerId: 'emp-001',
        resourceTenantId: 'tenant-corp',
        payload: { value: '12000.00' },
        isUpdate: true,
      };

      // Valid mutation passes
      expect(() => assertObjectMutationAllowed(user, validCtx)).not.toThrow();

      // Cross-tenant attempt fails
      expect(() =>
        assertObjectMutationAllowed(user, { ...validCtx, resourceTenantId: 'other-corp' })
      ).toThrow(/cross-tenant record mutation forbidden/);

      // Cross-user ownership attempt fails
      expect(() =>
        assertObjectMutationAllowed(user, { ...validCtx, resourceOwnerId: 'emp-999' })
      ).toThrow(/unauthorized cross-user mutation/);

      // Immutable field tampering fails
      expect(() =>
        assertObjectMutationAllowed(user, { ...validCtx, payload: { id: 'new-id' } })
      ).toThrow(/modification of immutable field/);
    });

    it('createEndpointAuthPreHandlers generates functional preHandler chain', async () => {
      const mockAuthenticate = async (req: any) => {
        req.user = { sub: 'usr-1', roles: [Roles.VIEWER] };
      };
      const mockFastify = { authenticate: mockAuthenticate } as any;

      const handlers = createEndpointAuthPreHandlers(mockFastify, {
        endpointKey: 'DEALS_LIST',
      });
      expect(handlers).toHaveLength(2);
      expect(typeof handlers[0]).toBe('function');
      expect(typeof handlers[1]).toBe('function');

      const mockReq = {
        headers: {},
        user: { sub: 'usr-1', roles: [Roles.VIEWER] },
      } as any;
      const mockReply = {} as any;

      // Viewer is allowed on DEALS_LIST
      await expect(handlers[1](mockReq, mockReply)).resolves.toBeUndefined();

      // When role is not allowed, throws 403
      const writeHandlers = createEndpointAuthPreHandlers(mockFastify, 'DEALS_CREATE');
      await expect(writeHandlers[1](mockReq, mockReply)).rejects.toThrow(/Access denied/);
    });
  });
});
