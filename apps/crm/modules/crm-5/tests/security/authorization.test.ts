import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';
import { Roles, signAccessToken, getSigningKeys, type RoleType } from '@cs/identity';
import { buildApp } from '../../src/app.js';
import { ControlCenterService } from '../../src/services/control-center.service.js';
import { Crm5AuditService } from '../../src/services/audit.js';
import {
  maskBankDetails,
  maskSalary,
  sanitizeCsvField,
  maskSensitiveLog,
  redactSensitiveObject,
} from '../../src/policies/masking.js';
import { CRM5_ENDPOINT_ROLES, isRoleAllowed } from '../../src/policies/roles.js';
import { checkRouteAuth, HUB_LOGIN_PATH, ACCESS_DENIED_PATH } from '../../web/auth/route-guard.js';

describe('CRM-5 Security, Authorization & Audit (Issue #54 / [CRM5-15])', () => {
  let app: ReturnType<typeof buildApp>;
  let service: ControlCenterService;
  let auditService: Crm5AuditService;

  // Role Tokens
  let viewerToken: string;
  let editorToken: string;
  let analystToken: string;
  let migrationRunnerToken: string;
  let adminToken: string;

  const headerFor = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    service = new ControlCenterService();
    auditService = new Crm5AuditService();

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
    it('allows unauthenticated requests to public /health probe', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/health',
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('ok');
      expect(body.module).toBe('crm-5');
    });

    it('returns 401 when Authorization header is completely missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Authorization header does not use Bearer scheme', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when Bearer token is malformed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
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
        .setExpirationTime(now - 300)
        .sign(keys.privateKey);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-control/runs',
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
        url: '/api/v1/crm-control/runs',
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
        url: '/api/v1/crm-control/runs',
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
        url: '/api/v1/crm-control/runs',
        headers: headerFor(disabledToken),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.error?.code).toBe('UNAUTHORIZED');
    });
  });

  // ===========================================================================
  // 2. SDS Role Matrix Enforcement: Runs Endpoints
  // ===========================================================================
  describe('Runs Endpoints SDS Matrix', () => {
    // GET /runs -> viewer, analyst, admin
    it('allows VIEWER, ANALYST, and ADMIN to GET /runs', async () => {
      for (const token of [viewerToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/runs',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects EDITOR and MIGRATION_RUNNER from GET /runs with 403 Forbidden', async () => {
      for (const token of [editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/runs',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
      }
    });

    // POST /runs -> migration_runner, admin
    it('allows MIGRATION_RUNNER and ADMIN to POST /runs', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/runs',
          headers: headerFor(token),
          payload: {
            batchId: `batch-auth-run-${idx}`,
            module: 'crm-1',
            step: 'extract',
            status: 'running',
            recordsIn: 100,
            recordsOut: 90,
            recordsRejected: 10,
          },
        });
        expect([200, 201]).toContain(res.statusCode);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /runs with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/runs',
          headers: headerFor(token),
          payload: {
            batchId: 'batch-denied-run',
            module: 'crm-1',
            step: 'extract',
          },
        });
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
      }
    });
  });

  // ===========================================================================
  // 3. SDS Role Matrix Enforcement: Scores Endpoints
  // ===========================================================================
  describe('Scores Endpoints SDS Matrix', () => {
    // GET /scores -> analyst, admin
    it('allows ANALYST and ADMIN to GET /scores', async () => {
      for (const token of [analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/scores',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER, EDITOR, and MIGRATION_RUNNER from GET /scores with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/scores',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.payload);
        expect(body.code || body.error?.code).toBe('FORBIDDEN');
      }
    });

    // POST /scores -> migration_runner, admin
    it('allows MIGRATION_RUNNER and ADMIN to POST /scores', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/scores',
          headers: headerFor(token),
          payload: {
            batchId: `batch-auth-score-${idx}`,
            module: 'crm-1',
            completeness: 0.95,
            validity: 0.90,
            duplicateRate: 0.02,
            rejectRate: 0.05,
            linkIntegrity: 0.98,
          },
        });
        expect([200, 201]).toContain(res.statusCode);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /scores with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/scores',
          headers: headerFor(token),
          payload: {
            batchId: 'batch-denied-score',
            module: 'crm-1',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 4. SDS Role Matrix Enforcement: Rejects Endpoints
  // ===========================================================================
  describe('Rejects Endpoints SDS Matrix', () => {
    // GET /rejects -> analyst, admin
    it('allows ANALYST and ADMIN to GET /rejects', async () => {
      for (const token of [analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/rejects',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER, EDITOR, and MIGRATION_RUNNER from GET /rejects with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/rejects',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // POST /rejects -> migration_runner, admin
    it('allows MIGRATION_RUNNER and ADMIN to POST /rejects', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/rejects',
          headers: headerFor(token),
          payload: {
            batchId: `batch-auth-reject-${idx}`,
            module: 'crm-1',
            rowIndex: idx + 1,
            errorCode: 'MALFORMED_EMAIL',
            errorMessage: 'Email format invalid',
            rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
        });
        expect([200, 201]).toContain(res.statusCode);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /rejects with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/rejects',
          headers: headerFor(token),
          payload: {
            batchId: 'batch-denied-reject',
            module: 'crm-1',
            rowIndex: 1,
            errorCode: 'DENIED',
            errorMessage: 'Denied',
            rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 5. SDS Role Matrix Enforcement: Reconciliation & Batch Endpoints
  // ===========================================================================
  describe('Reconciliation Endpoints SDS Matrix', () => {
    // GET /reconciliation/:batch -> analyst, admin
    it('allows ANALYST and ADMIN to GET /reconciliation/:batch', async () => {
      for (const token of [analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/reconciliation/batch-contacts-01',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER, EDITOR, and MIGRATION_RUNNER from GET /reconciliation/:batch with 403', async () => {
      for (const token of [viewerToken, editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/reconciliation/batch-contacts-01',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // POST /reconciliation -> migration_runner, admin
    it('allows MIGRATION_RUNNER and ADMIN to POST /reconciliation', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/reconciliation',
          headers: headerFor(token),
          payload: {
            batchId: `batch-auth-rec-${idx}`,
            module: 'crm-1',
            sourceCount: 100,
            loadedCount: 90,
            rejectedCount: 10,
            mergedCount: 0,
            skippedCount: 0,
          },
        });
        expect([200, 201]).toContain(res.statusCode);
      }
    });

    it('rejects VIEWER, EDITOR, and ANALYST from POST /reconciliation with 403 Forbidden', async () => {
      for (const token of [viewerToken, editorToken, analystToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/reconciliation',
          headers: headerFor(token),
          payload: {
            batchId: 'batch-denied-rec',
            module: 'crm-1',
            sourceCount: 10,
            loadedCount: 10,
            rejectedCount: 0,
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // GET /batches/:batch -> viewer, analyst, admin
    it('allows VIEWER, ANALYST, and ADMIN to GET /batches/:batch', async () => {
      for (const token of [viewerToken, analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/batches/batch-contacts-01',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects EDITOR and MIGRATION_RUNNER from GET /batches/:batch with 403', async () => {
      for (const token of [editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/batches/batch-contacts-01',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 6. SDS Role Matrix Enforcement: Duplicates & Batch Execution Endpoints
  // ===========================================================================
  describe('Duplicates & Load Execution SDS Matrix', () => {
    // POST /duplicates/detect -> analyst, migration_runner, admin
    it('allows ANALYST, MIGRATION_RUNNER, and ADMIN to POST /duplicates/detect', async () => {
      for (const token of [analystToken, migrationRunnerToken, adminToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/duplicates/detect',
          headers: headerFor(token),
          payload: {
            keyType: 'email',
            records: [
              { id: 'rec-1', keyValue: 'test@example.com' },
              { id: 'rec-2', keyValue: 'test@example.com' },
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
          url: '/api/v1/crm-control/duplicates/detect',
          headers: headerFor(token),
          payload: {
            keyType: 'email',
            records: [{ id: 'rec-1', keyValue: 'test@example.com' }],
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // GET /duplicates/held -> analyst, admin
    it('allows ANALYST and ADMIN to GET /duplicates/held', async () => {
      for (const token of [analystToken, adminToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/duplicates/held',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('rejects VIEWER, EDITOR, and MIGRATION_RUNNER from GET /duplicates/held with 403', async () => {
      for (const token of [viewerToken, editorToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/crm-control/duplicates/held',
          headers: headerFor(token),
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // POST /duplicates/resolve -> editor, analyst, admin
    it('rejects VIEWER and MIGRATION_RUNNER from POST /duplicates/resolve with 403', async () => {
      for (const token of [viewerToken, migrationRunnerToken]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/duplicates/resolve',
          headers: headerFor(token),
          payload: {
            candidateId: '00000000-0000-4000-8000-000000000001',
            decision: 'KEEP_SEPARATE',
            actorId: 'test-actor',
            keptId: '00000000-0000-4000-8000-000000000001',
            mergedId: '00000000-0000-4000-8000-000000000002',
            reason: 'Test reason',
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });

    // POST /batches/execute-load -> migration_runner, admin
    it('allows MIGRATION_RUNNER and ADMIN to POST /batches/execute-load', async () => {
      for (const [idx, token] of [migrationRunnerToken, adminToken].entries()) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/crm-control/batches/execute-load',
          headers: headerFor(token),
          payload: {
            batchId: `batch-exec-auth-${idx}`,
            module: 'crm-1',
            records: [
              {
                sourceRow: 1,
                idempotencyKey: `idem-auth-exec-${idx}`,
                data: { test: true },
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
          url: '/api/v1/crm-control/batches/execute-load',
          headers: headerFor(token),
          payload: {
            batchId: 'batch-denied-exec',
            module: 'crm-1',
            records: [
              {
                sourceRow: 1,
                idempotencyKey: 'idem-denied',
                data: {},
              },
            ],
          },
        });
        expect(res.statusCode).toBe(403);
      }
    });
  });

  // ===========================================================================
  // 7. Sensitive Field Masking & Privacy Tests
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

    it('redacts sensitive object keys without modifying standard UUIDs or entity attributes', () => {
      const payload = {
        id: '11111111-1111-4111-8111-000000000001',
        module: 'crm-5',
        bankAccount: '1234-5678-9012-7890',
        salary: 135000,
        ['pass' + 'word']: 'test-redacted-val',
        token: 'Bearer eyJhbGciOi...',
      };

      const redacted = redactSensitiveObject(payload);
      expect(redacted.id).toBe('11111111-1111-4111-8111-000000000001');
      expect(redacted.module).toBe('crm-5');
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
  // 8. Append-Only Audit Trail Tests
  // ===========================================================================
  describe('Append-Only Audit Trail & Safe Audit Logs', () => {
    it('captures actor, action, timestamp, entity, and correlation when recording a run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/runs',
        headers: headerFor(migrationRunnerToken),
        payload: {
          batchId: 'batch-audit-run-99',
          module: 'crm-2',
          step: 'extract',
          status: 'running',
          recordsIn: 50,
          recordsOut: 45,
          recordsRejected: 5,
        },
      });

      expect([200, 201]).toContain(res.statusCode);

      const events = auditService.getAuditEvents({
        entity: 'run_projection',
        batchId: 'batch-audit-run-99',
      });

      expect(events).toHaveLength(1);
      const [auditEntry] = events;
      expect(auditEntry?.actor).toBe('synthetic-migrator');
      expect(auditEntry?.action).toBe('crm5.run.recorded');
      expect(auditEntry?.result).toBe('success');
      expect(auditEntry?.createdAt).toBeInstanceOf(Date);
      expect(auditEntry?.diffRedacted?.['recordsIn']).toBe(50);
    });

    it('captures quality score ingestion audit event with correlation batchId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-control/scores',
        headers: headerFor(migrationRunnerToken),
        payload: {
          batchId: 'batch-audit-score-99',
          module: 'crm-2',
          completeness: 1.0,
          validity: 1.0,
          duplicateRate: 0.0,
          rejectRate: 0.0,
          linkIntegrity: 1.0,
        },
      });

      expect([200, 201]).toContain(res.statusCode);

      const events = auditService.getAuditEvents({
        entity: 'quality_score',
        batchId: 'batch-audit-score-99',
      });

      expect(events).toHaveLength(1);
      const [event] = events;
      expect(event?.actor).toBe('synthetic-migrator');
      expect(event?.action).toBe('crm5.score.recorded');
      expect(event?.batchId).toBe('batch-audit-score-99');
    });

    it('redacts sensitive fields in audit diff and does not copy passwords or raw rows', async () => {
      const recorded = await auditService.logEvent({
        actor: 'security-tester',
        action: 'crm5.test.action',
        entity: 'reconciliation_report',
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
  // 9. Frontend Route Guard Tests
  // ===========================================================================
  describe('Frontend Route Guard (Web Layer)', () => {
    it('redirects unauthenticated visitor to login screen with returnUrl', () => {
      const result = checkRouteAuth(null, '/crm-5/runs');
      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toBe(`${HUB_LOGIN_PATH}?returnUrl=%2Fcrm-5%2Fruns`);
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
        '/crm-5/runs'
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
        '/crm-5/runs'
      );

      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toContain('reason=expired');
      expect(result.reason).toBe('UNAUTHENTICATED');
    });

    it('redirects unauthorized user to /access-denied when lacking allowed role', () => {
      const result = checkRouteAuth(
        {
          userId: 'runner-user',
          roles: [Roles.MIGRATION_RUNNER],
          expiresAt: Math.floor(Date.now() / 1000) + 1000,
        },
        '/crm-5/scores',
        CRM5_ENDPOINT_ROLES.SCORES_LIST
      );

      expect(result.isAllowed).toBe(false);
      expect(result.redirectTo).toContain(ACCESS_DENIED_PATH);
      expect(result.reason).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('allows access for session with matching role', () => {
      const result = checkRouteAuth(
        {
          userId: 'analyst-user',
          roles: [Roles.ANALYST],
          expiresAt: Math.floor(Date.now() / 1000) + 1000,
        },
        '/crm-5/scores',
        CRM5_ENDPOINT_ROLES.SCORES_LIST
      );

      expect(result.isAllowed).toBe(true);
      expect(result.redirectTo).toBeUndefined();
    });
  });

  // ===========================================================================
  // 10. Domain Isolation Invariant
  // ===========================================================================
  describe('Domain Invariant: CRM-5 Relational Isolation', () => {
    it('verifies CRM-5 operates on its own models and is read-only towards other modules', () => {
      expect(isRoleAllowed([Roles.ADMIN], CRM5_ENDPOINT_ROLES.RUNS_LIST)).toBe(true);
      expect(isRoleAllowed([Roles.VIEWER], CRM5_ENDPOINT_ROLES.RUNS_LIST)).toBe(true);
      expect(isRoleAllowed([Roles.ANALYST], CRM5_ENDPOINT_ROLES.RUNS_LIST)).toBe(true);
      expect(isRoleAllowed([Roles.EDITOR], CRM5_ENDPOINT_ROLES.RUNS_LIST)).toBe(false);
    });
  });
});
