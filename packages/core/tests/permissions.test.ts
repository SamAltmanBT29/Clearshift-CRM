import { describe, it, expect, beforeEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import {
  ClearShiftRoles,
  type RoleType,
  RouteGroups,
  CENTRAL_ROLE_CAPABILITY_MATRIX,
  CENTRAL_ROUTE_POLICIES,
  findRoutePolicy,
  DenyCodes,
} from '@clearshift/contracts';
import {
  evaluateRouteAccess,
  maskRecordForRole,
  maskRecordsForRole,
  maskBankDetails,
  maskGovernmentId,
  maskSalary,
  exportCsvWithFieldMasking,
  requireRoles,
} from '../src/auth/permissions.js';
import { hubPolicyPlugin } from '../../../apps/hub/src/policies/policy-plugin.js';
import { AppError } from '@cs/kernel';

describe('[PLT-06] Central Role & Field-Level Authorization Matrix', () => {
  const allRoles: readonly RoleType[] = [
    ClearShiftRoles.VIEWER,
    ClearShiftRoles.EDITOR,
    ClearShiftRoles.MIGRATION_RUNNER,
    ClearShiftRoles.ANALYST,
    ClearShiftRoles.ADMIN,
  ];

  // ===========================================================================
  // 1. Central Policy & Default Deny Matrix Tests
  // ===========================================================================
  describe('Central Route Matrix & Default Deny', () => {
    it('enforces default deny on unregistered or null route policies', () => {
      for (const role of allRoles) {
        const result = evaluateRouteAccess(undefined, [role]);
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(403);
        expect(result.denyCode).toBe(DenyCodes.DEFAULT_DENY);
      }
    });

    it('enforces default deny on routes with empty allowedRoles', () => {
      const emptyPolicy = {
        path: '/api/v1/unconfigured-resource',
        method: 'GET' as const,
        allowedRoles: [],
      };
      for (const role of allRoles) {
        const result = evaluateRouteAccess(emptyPolicy, [role]);
        expect(result.allowed).toBe(false);
        expect(result.statusCode).toBe(403);
        expect(result.denyCode).toBe(DenyCodes.DEFAULT_DENY);
      }
    });

    it('permits access to public routes without authentication', () => {
      const publicRoutes = CENTRAL_ROUTE_POLICIES.filter((p) => p.isPublic);
      expect(publicRoutes.length).toBeGreaterThanOrEqual(4);

      for (const policy of publicRoutes) {
        // Without user roles (unauthenticated)
        const unauthResult = evaluateRouteAccess(policy, undefined);
        expect(unauthResult.allowed).toBe(true);
        expect(unauthResult.statusCode).toBe(200);

        // With any user role
        for (const role of allRoles) {
          const authResult = evaluateRouteAccess(policy, [role]);
          expect(authResult.allowed).toBe(true);
        }
      }
    });

    it('returns 401 Unauthorized when credentials are missing on protected routes', () => {
      const protectedRoutes = CENTRAL_ROUTE_POLICIES.filter((p) => !p.isPublic);

      for (const policy of protectedRoutes) {
        const missingUser = evaluateRouteAccess(policy, undefined);
        expect(missingUser.allowed).toBe(false);
        expect(missingUser.statusCode).toBe(401);
        expect(missingUser.denyCode).toBe(DenyCodes.UNAUTHENTICATED);

        const emptyRoles = evaluateRouteAccess(policy, []);
        expect(emptyRoles.allowed).toBe(false);
        expect(emptyRoles.statusCode).toBe(401);
        expect(emptyRoles.denyCode).toBe(DenyCodes.UNAUTHENTICATED);
      }
    });
  });

  // ===========================================================================
  // 2. Table-Driven Role Matrix Enumeration Against Every Route Group
  // ===========================================================================
  describe('Table-Driven Role Matrix Enumeration', () => {
    interface RouteTestCase {
      name: string;
      method: string;
      path: string;
      allowed: RoleType[];
      denied: RoleType[];
    }

    const testMatrix: RouteTestCase[] = [
      // 1. Hub Protected Routes
      {
        name: 'Hub Identity Map Lookup & Upsert',
        method: 'POST',
        path: '/api/v1/hub/id-map',
        allowed: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.ADMIN,
        ],
        denied: [ClearShiftRoles.ANALYST],
      },
      {
        name: 'Hub Admin Service Tokens',
        method: 'POST',
        path: '/api/v1/hub/admin/service-tokens',
        allowed: [ClearShiftRoles.ADMIN],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.ANALYST,
        ],
      },

      // 2. CRM Read Routes
      {
        name: 'CRM Contacts List (Read)',
        method: 'GET',
        path: '/api/v1/crm-contacts/contacts',
        allowed: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.ADMIN,
        ],
        denied: [ClearShiftRoles.MIGRATION_RUNNER],
      },
      {
        name: 'CRM Companies List (Read)',
        method: 'GET',
        path: '/api/v1/crm-contacts/companies',
        allowed: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ADMIN,
        ],
        denied: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ANALYST],
      },
      {
        name: 'CRM Reports & Dashboards',
        method: 'GET',
        path: '/api/v1/crm-contacts/reports',
        allowed: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.ADMIN,
        ],
        denied: [ClearShiftRoles.EDITOR, ClearShiftRoles.MIGRATION_RUNNER],
      },

      // 3. CRM Domain Mutation (Create & CRUD PATCH)
      {
        name: 'CRM Contacts Create',
        method: 'POST',
        path: '/api/v1/crm-contacts/contacts',
        allowed: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.ANALYST,
        ],
      },
      {
        name: 'CRM Contacts Patch (CRUD PATCH inherits Editor)',
        method: 'PATCH',
        path: '/api/v1/crm-contacts/contacts/:id',
        allowed: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.ANALYST,
        ],
      },

      // 4. Bulk Load Routes (Migration Runner Only)
      {
        name: 'CRM Direct Batch Import Load',
        method: 'POST',
        path: '/api/v1/crm-contacts/imports',
        allowed: [ClearShiftRoles.MIGRATION_RUNNER],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.ADMIN,
        ],
      },
      {
        name: 'Migration Kit Target Batch Load',
        method: 'POST',
        path: '/api/v1/migration-kit/batches/:id/load',
        allowed: [ClearShiftRoles.MIGRATION_RUNNER],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.ADMIN,
        ],
      },
      {
        name: 'ERP Finance Opening Balance Bulk Load',
        method: 'POST',
        path: '/api/v1/erp-finance/opening-balances/bulk',
        allowed: [ClearShiftRoles.MIGRATION_RUNNER],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.ADMIN,
        ],
      },
      {
        name: 'ERP HR Payroll Totals Bulk Load',
        method: 'POST',
        path: '/api/v1/erp-hr/payroll-totals/bulk',
        allowed: [ClearShiftRoles.MIGRATION_RUNNER],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.ADMIN,
        ],
      },

      // 5. Approval Separation of Duty (Migration Runner strictly prohibited)
      {
        name: 'Migration Kit Duplicate Merge Approval',
        method: 'POST',
        path: '/api/v1/migration-kit/batches/:id/merge',
        allowed: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
        denied: [
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.ANALYST,
        ],
      },
      {
        name: 'Migration Kit Skip Record Approval',
        method: 'POST',
        path: '/api/v1/migration-kit/batches/:id/skip',
        allowed: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
        denied: [
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.ANALYST,
        ],
      },

      // 6. Financial Reports & Journal
      {
        name: 'ERP Finance Trial Balance Report',
        method: 'GET',
        path: '/api/v1/erp-finance/trial-balance',
        allowed: [
          ClearShiftRoles.ANALYST,
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.ADMIN,
        ],
        denied: [ClearShiftRoles.EDITOR, ClearShiftRoles.MIGRATION_RUNNER],
      },
      {
        name: 'ERP Finance Post Journal',
        method: 'POST',
        path: '/api/v1/erp-finance/journal',
        allowed: [ClearShiftRoles.EDITOR, ClearShiftRoles.ADMIN],
        denied: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.MIGRATION_RUNNER,
          ClearShiftRoles.ANALYST,
        ],
      },

      // 7. HR Employee Records
      {
        name: 'ERP HR Employee List',
        method: 'GET',
        path: '/api/v1/erp-hr/employees',
        allowed: [
          ClearShiftRoles.VIEWER,
          ClearShiftRoles.EDITOR,
          ClearShiftRoles.ADMIN,
        ],
        denied: [ClearShiftRoles.MIGRATION_RUNNER, ClearShiftRoles.ANALYST],
      },
    ];

    for (const testCase of testMatrix) {
      it(`evaluates permissions correctly for: ${testCase.name} (${testCase.method} ${testCase.path})`, () => {
        const policy = findRoutePolicy(testCase.method, testCase.path);
        expect(policy, `Policy should exist for ${testCase.path}`).toBeDefined();

        // Check Allowed Roles
        for (const role of testCase.allowed) {
          const result = evaluateRouteAccess(policy, [role]);
          expect(
            result.allowed,
            `Expected role '${role}' to be ALLOWED on ${testCase.path}, but was denied: ${result.message}`
          ).toBe(true);
          expect(result.statusCode).toBe(200);
        }

        // Check Denied Roles
        for (const role of testCase.denied) {
          const result = evaluateRouteAccess(policy, [role]);
          expect(
            result.allowed,
            `Expected role '${role}' to be DENIED on ${testCase.path}, but was allowed`
          ).toBe(false);
          expect(result.statusCode).toBe(403);
          expect(result.denyCode).toBeDefined();
        }
      });
    }

    it('enforces that Migration Runner CANNOT approve its own merge/skip decisions even if mixed with other roles', () => {
      const mergePolicy = findRoutePolicy(
        'POST',
        '/api/v1/migration-kit/batches/:id/merge'
      );
      expect(mergePolicy).toBeDefined();

      // Only migration_runner role
      const runnerOnly = evaluateRouteAccess(mergePolicy, [
        ClearShiftRoles.MIGRATION_RUNNER,
      ]);
      expect(runnerOnly.allowed).toBe(false);
      expect(runnerOnly.statusCode).toBe(403);
      expect(runnerOnly.denyCode).toBe(DenyCodes.SELF_APPROVAL_FORBIDDEN);

      // Attempting self approval via context flag
      const selfApproval = evaluateRouteAccess(
        mergePolicy,
        [ClearShiftRoles.EDITOR],
        { isMigrationRunnerSelfApproval: true }
      );
      expect(selfApproval.allowed).toBe(false);
      expect(selfApproval.statusCode).toBe(403);
      expect(selfApproval.denyCode).toBe(DenyCodes.SELF_APPROVAL_FORBIDDEN);
    });
  });

  // ===========================================================================
  // 3. Field-Level Masking & Redaction Unit Tests
  // ===========================================================================
  describe('Field-Level Masking Engine', () => {
    it('masks bank details to XXXX-XXXX-7890 preserving only terminal 4 digits', () => {
      expect(maskBankDetails('1234567890123456')).toBe('XXXX-XXXX-3456');
      expect(maskBankDetails('US1234567890')).toBe('XXXX-XXXX-7890');
      expect(maskBankDetails('123')).toBe('XXXX');
      expect(maskBankDetails('')).toBe('');
      expect(maskBankDetails(null)).toBe('');
    });

    it('masks government identifiers (SSN, Tax ID) preserving only terminal 4 digits', () => {
      expect(maskGovernmentId('SYNTHETIC-SSN-6789')).toBe('***-**-6789');
      expect(maskGovernmentId('TAX-987654321')).toBe('***-**-4321');
      expect(maskGovernmentId('12')).toBe('[REDACTED_ID]');
    });

    it('masks salary and compensation to XX,XXX or salary hidden', () => {
      expect(maskSalary(125000)).toBe('XX,XXX');
      expect(maskSalary('85000')).toBe('XX,XXX');
      expect(maskSalary(null)).toBe('salary hidden');
      expect(maskSalary(undefined)).toBe('salary hidden');
      expect(maskSalary('')).toBe('salary hidden');
    });

    it('guarantees NO role (including Admin) can read credentials or tokens', () => {
      const sensitiveRecord = {
        id: 'user-001',
        username: 'synthetic_user',
        password: 'superSecretPassword123!',
        argon2hash: '$argon2id$v=19$m=65536,t=3,p=4$fakehash...',
        token: 'eyJhbGciOiJFZERTQSI...',
        jwt: 'cs_tok_9999999999',
        apiKey: 'cs_live_apikey_12345',
        clientSecret: 'secret_client_xyz',
      };

      for (const role of allRoles) {
        const masked = maskRecordForRole(sensitiveRecord, [role]);
        expect(masked.password).toBe('[REDACTED]');
        expect(masked.argon2hash).toBe('[REDACTED]');
        expect(masked.token).toBe('[REDACTED]');
        expect(masked.jwt).toBe('[REDACTED]');
        expect(masked.apiKey).toBe('[REDACTED]');
        expect(masked.clientSecret).toBe('[REDACTED]');
        // Non-sensitive fields preserved
        expect(masked.id).toBe('user-001');
        expect(masked.username).toBe('synthetic_user');
      }
    });

    it('guarantees NO role (including Admin) can read bank details or government identifiers', () => {
      const employeeRecord = {
        employeeId: 'EMP-101',
        name: 'Synthetic Employee',
        bankAccount: '9876543210123456',
        iban: 'GB82WEST12345678901234',
        routingNumber: '121000358',
        ssn: 'SYNTHETIC-SSN-6789',
        taxId: 'US-99887766',
      };

      for (const role of allRoles) {
        const masked = maskRecordForRole(employeeRecord, [role]);
        expect(masked.bankAccount).toBe('XXXX-XXXX-3456');
        expect(masked.iban).toBe('XXXX-XXXX-1234');
        expect(masked.routingNumber).toBe('XXXX-XXXX-0358');
        expect(masked.ssn).toBe('***-**-6789');
        expect(masked.taxId).toBe('***-**-7766');
      }
    });

    it('handles salary visibility: Admin visible under HR policy; Viewer & others masked', () => {
      const payrollRecord = {
        employeeId: 'EMP-202',
        name: 'Jane Synthetic',
        salary: 135000,
        baseSalary: '120000',
        compensation: 15000,
      };

      // 1. Viewer -> Masked
      const viewerResult = maskRecordForRole(payrollRecord, [ClearShiftRoles.VIEWER]);
      expect(viewerResult.salary).toBe('XX,XXX');
      expect(viewerResult.baseSalary).toBe('XX,XXX');
      expect(viewerResult.compensation).toBe('XX,XXX');

      // 2. Editor -> Masked
      const editorResult = maskRecordForRole(payrollRecord, [ClearShiftRoles.EDITOR]);
      expect(editorResult.salary).toBe('XX,XXX');

      // 3. Migration Runner -> Masked
      const runnerResult = maskRecordForRole(payrollRecord, [ClearShiftRoles.MIGRATION_RUNNER]);
      expect(runnerResult.salary).toBe('XX,XXX');

      // 4. Analyst -> Masked
      const analystResult = maskRecordForRole(payrollRecord, [ClearShiftRoles.ANALYST]);
      expect(analystResult.salary).toBe('XX,XXX');

      // 5. Admin (Approved HR Policy) -> Visible
      const adminResult = maskRecordForRole(payrollRecord, [ClearShiftRoles.ADMIN], {
        hrSalaryPolicyApproved: true,
      });
      expect(adminResult.salary).toBe(135000);
      expect(adminResult.baseSalary).toBe('120000');
      expect(adminResult.compensation).toBe(15000);

      // 6. Admin without HR policy approval -> Masked
      const adminUnapproved = maskRecordForRole(payrollRecord, [ClearShiftRoles.ADMIN], {
        hrSalaryPolicyApproved: false,
      });
      expect(adminUnapproved.salary).toBe('XX,XXX');
    });

    it('handles nested objects and arrays recursively', () => {
      const complexObject = {
        company: 'ClearShift Synthetic Corp',
        executives: [
          {
            name: 'Alice',
            salary: 200000,
            accountNumber: '1111222233334444',
            token: 'secret-token-alice',
          },
          {
            name: 'Bob',
            salary: 180000,
            accountNumber: '5555666677778888',
            token: 'secret-token-bob',
          },
        ],
      };

      const viewerMasked = maskRecordForRole(complexObject, [ClearShiftRoles.VIEWER]);
      expect(viewerMasked.executives[0].salary).toBe('XX,XXX');
      expect(viewerMasked.executives[0].accountNumber).toBe('XXXX-XXXX-4444');
      expect(viewerMasked.executives[0].token).toBe('[REDACTED]');
      expect(viewerMasked.executives[1].salary).toBe('XX,XXX');
      expect(viewerMasked.executives[1].accountNumber).toBe('XXXX-XXXX-8888');
      expect(viewerMasked.executives[1].token).toBe('[REDACTED]');
    });
  });

  // ===========================================================================
  // 4. CSV Export Field Masking & Formula Neutralization
  // ===========================================================================
  describe('CSV Export Masking & Formula Safety', () => {
    const rawExportRecords = [
      {
        name: 'Alice Synthetic',
        bankAccount: '1111222233334444',
        salary: 95000,
        notes: '=cmd|\' /C calc\'!A0', // formula injection attempt
        token: 'auth-bearer-token-secret',
      },
      {
        name: '+Bob Formula',
        bankAccount: '5555666677778888',
        salary: 110000,
        notes: '@SUM(1+1)*cmd|\' /C calc\'!A0',
        token: 'jwt-token-987654',
      },
    ];

    it('masks bank details, salary for Viewer, strips tokens, and neutralizes formula injections in CSV', () => {
      const csv = exportCsvWithFieldMasking(rawExportRecords, [ClearShiftRoles.VIEWER]);

      // 1. Bank Details are masked
      expect(csv).toContain('XXXX-XXXX-4444');
      expect(csv).toContain('XXXX-XXXX-8888');
      expect(csv).not.toContain('1111222233334444');

      // 2. Viewer Salary is masked
      expect(csv).toContain('XX,XXX');
      expect(csv).not.toContain('95000');
      expect(csv).not.toContain('110000');

      // 3. Tokens are redacted
      expect(csv).toContain('[REDACTED]');
      expect(csv).not.toContain('auth-bearer-token-secret');
      expect(csv).not.toContain('jwt-token-987654');

      // 4. Formulas are neutralized with leading apostrophe (')
      expect(csv).toContain("'=cmd|' /C calc'!A0");
      expect(csv).toContain("'+Bob Formula");
      expect(csv).toContain("'@SUM(1+1)*cmd|' /C calc'!A0");
    });

    it('allows Admin salary in CSV under HR policy while still masking bank details and neutralizing formulas', () => {
      const csv = exportCsvWithFieldMasking(rawExportRecords, [ClearShiftRoles.ADMIN]);

      // Bank details STILL masked for Admin
      expect(csv).toContain('XXXX-XXXX-4444');
      expect(csv).not.toContain('1111222233334444');

      // Admin salary visible
      expect(csv).toContain('95000');
      expect(csv).toContain('110000');

      // Tokens still redacted for Admin
      expect(csv).toContain('[REDACTED]');

      // Formulas still neutralized
      expect(csv).toContain("'=cmd|' /C calc'!A0");
    });
  });

  // ===========================================================================
  // 5. Fastify Server & Route Guard Integration Tests
  // ===========================================================================
  describe('Fastify Route Guard & Policy Plugin Integration', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = fastify();

      // Custom mock user authentication decorator
      app.decorateRequest('user', undefined);
      app.addHook('onRequest', async (req) => {
        const roleHeader = req.headers['x-role'] as string;
        if (roleHeader) {
          (req as any).user = {
            sub: 'synthetic-user-1',
            roles: roleHeader.split(',').map((r) => r.trim()) as RoleType[],
          };
        }
      });

      // Register central policy plugin
      await app.register(hubPolicyPlugin, { strictDefaultDeny: true });

      // Register route endpoints
      app.get('/api/v1/hub/health/live', async () => ({ status: 'live' }));
      app.get('/api/v1/crm-contacts/contacts', async () => [
        {
          id: 'contact-1',
          name: 'Contact A',
          bankAccount: '1234567890123456',
          salary: 75000,
          token: 'sensitive-token',
        },
      ]);
      app.post('/api/v1/crm-contacts/contacts', async () => ({
        status: 'created',
      }));
      app.post('/api/v1/migration-kit/batches/:id/load', async () => ({
        status: 'loaded',
      }));
      app.post('/api/v1/migration-kit/batches/:id/merge', async () => ({
        status: 'merged',
      }));
      app.get('/api/v1/unregistered-secret-endpoint', async () => ({
        secret: 'should-never-be-reached',
      }));

      await app.ready();
    });

    it('allows public route access without any user authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/hub/health/live',
      });
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'live' });
    });

    it('returns 401 Unauthorized for unauthenticated calls to protected routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts',
      });
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.payload);
      expect(body.code || body.message).toBeDefined();
    });

    it('returns 403 Forbidden on unregistered routes (Default Deny) even for Admin', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/unregistered-secret-endpoint',
        headers: { 'x-role': ClearShiftRoles.ADMIN },
      });
      expect(response.statusCode).toBe(403);
    });

    it('allows Viewer to read contacts and masks sensitive fields in response JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/crm-contacts/contacts',
        headers: { 'x-role': ClearShiftRoles.VIEWER },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data[0].id).toBe('contact-1');
      expect(data[0].name).toBe('Contact A');
      // Field Masking verified
      expect(data[0].bankAccount).toBe('XXXX-XXXX-3456');
      expect(data[0].salary).toBe('XX,XXX');
      expect(data[0].token).toBe('[REDACTED]');
    });

    it('prohibits Viewer from calling mutation endpoints (403 Forbidden)', async () => {
      // Direct API call simulation: hidden UI button is not the security boundary
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/crm-contacts/contacts',
        headers: { 'x-role': ClearShiftRoles.VIEWER },
        payload: { name: 'Direct API bypass attempt' },
      });

      expect(response.statusCode).toBe(403);
    });

    it('allows Migration Runner to execute bulk load, but denies merge approval', async () => {
      // 1. Bulk Load -> Allowed
      const loadResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/migration-kit/batches/123e4567-e89b-12d3-a456-426614174000/load',
        headers: { 'x-role': ClearShiftRoles.MIGRATION_RUNNER },
      });
      expect(loadResponse.statusCode).toBe(200);

      // 2. Merge Approval -> Forbidden (403)
      const mergeResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/migration-kit/batches/123e4567-e89b-12d3-a456-426614174000/merge',
        headers: { 'x-role': ClearShiftRoles.MIGRATION_RUNNER },
      });
      expect(mergeResponse.statusCode).toBe(403);
    });

    it('allows Editor to approve merge, but denies bulk load', async () => {
      // 1. Merge Approval -> Allowed
      const mergeResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/migration-kit/batches/123e4567-e89b-12d3-a456-426614174000/merge',
        headers: { 'x-role': ClearShiftRoles.EDITOR },
      });
      expect(mergeResponse.statusCode).toBe(200);

      // 2. Bulk Load -> Forbidden (403)
      const loadResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/migration-kit/batches/123e4567-e89b-12d3-a456-426614174000/load',
        headers: { 'x-role': ClearShiftRoles.EDITOR },
      });
      expect(loadResponse.statusCode).toBe(403);
    });
  });
});
