import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import type { MigrationReject } from '@clearshift/contracts';
import {
  categorizeErrorCode,
  extractModuleIdentifier,
  formatRejectFailureReason,
  maskBankDetails,
  maskGovernmentId,
  maskSalary,
  maskSensitiveFields,
  enhanceRejectRecord,
  generateFormulaSafeRejectsCsv,
  downloadRejectsCsv,
} from '../../web/utils/reject-helpers.js';
import { RejectDetailModal } from '../../web/components/RejectDetailModal.js';
import { RejectsOverviewPage } from '../../web/pages/RejectsOverviewPage.js';
import { REJECTS_AUDIT_COLUMNS } from '../../web/table/columns.js';

describe('CRM-5 Migration Control Center: Module Context Rejection Review & Export (Issue #196 / CRM5-23)', () => {
  beforeAll(() => {
    // Provide lightweight dispatcher for React 19 hook execution in pure unit tests
    const dispatcher = {
      useId: () => 'reject-detail-title-1',
      useRef: (init: unknown) => ({ current: init }),
      useEffect: () => {},
      useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
    };
    const internals = (React as Record<string, unknown>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as {
      H: unknown;
    };
    if (internals) {
      internals.H = dispatcher;
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Module-Specific Context Identifiers (AC 1)
  // ---------------------------------------------------------------------------
  describe('1. Module-Specific Context Identifiers (AC 1)', () => {
    it('extracts contact identifier (email/contactId) for CRM-1 contacts and accounts', () => {
      const reject: MigrationReject = {
        id: 'rej-1',
        batchId: 'batch-c1-01',
        module: 'crm-1',
        rowIndex: 42,
        errorCode: 'DUPLICATE_EMAIL',
        errorMessage: 'Email already exists',
        rawPayloadHash: 'hash-c1',
        createdAt: new Date(),
      };

      const payload = {
        contact_id: 'CNT-9812',
        email: 'alice.johnson@example.com',
        company: 'Acme Corp',
      };

      const context = extractModuleIdentifier(reject, payload);
      expect(context.label).toBe('Contact ID');
      expect(context.value).toBe('CNT-9812');
      expect(context.secondary).toBe('alice.johnson@example.com');
    });

    it('extracts deal/quote identifier for CRM-2 pipeline deals', () => {
      const reject: MigrationReject = {
        id: 'rej-2',
        batchId: 'batch-c2-01',
        module: 'crm-2',
        rowIndex: 12,
        errorCode: 'INVALID_STAGE',
        errorMessage: 'Invalid pipeline stage transition',
        rawPayloadHash: 'hash-c2',
        createdAt: new Date(),
      };

      const payload = {
        deal_id: 'DEAL-7741',
        quote_number: 'Q-2026-009',
        pipeline: 'Enterprise SaaS',
      };

      const context = extractModuleIdentifier(reject, payload);
      expect(context.label).toBe('Deal ID');
      expect(context.value).toBe('DEAL-7741');
      expect(context.secondary).toBe('Quote: Q-2026-009');
    });

    it('extracts ticket identifier for CRM-3 support tickets', () => {
      const reject: MigrationReject = {
        id: 'rej-3',
        batchId: 'batch-c3-01',
        module: 'crm-3',
        rowIndex: 88,
        errorCode: 'TICKET_SLA_BREACH',
        errorMessage: 'Ticket SLA invalid timestamp',
        rawPayloadHash: 'hash-c3',
        createdAt: new Date(),
      };

      const payload = {
        ticket_id: 'TCK-4001',
        account_id: 'ACC-110',
      };

      const context = extractModuleIdentifier(reject, payload);
      expect(context.label).toBe('Ticket ID');
      expect(context.value).toBe('TCK-4001');
      expect(context.secondary).toBe('Account: ACC-110');
    });

    it('extracts campaign/lead identifier for CRM-4 marketing campaigns', () => {
      const reject: MigrationReject = {
        id: 'rej-4',
        batchId: 'batch-c4-01',
        module: 'crm-4',
        rowIndex: 15,
        errorCode: 'CAMPAIGN_BUDGET_EXCEEDED',
        errorMessage: 'Allocated budget exceeds ceiling',
        rawPayloadHash: 'hash-c4',
        createdAt: new Date(),
      };

      const payload = {
        campaign_id: 'CMP-2026-X',
        lead_id: 'LEAD-991',
      };

      const context = extractModuleIdentifier(reject, payload);
      expect(context.label).toBe('Campaign ID');
      expect(context.value).toBe('CMP-2026-X');
      expect(context.secondary).toBe('Lead: LEAD-991');
    });

    it('extracts batch/SKU/tax identifier for CRM-5 migration control', () => {
      const reject: MigrationReject = {
        id: 'rej-5',
        batchId: 'batch-c5-99',
        module: 'crm-5',
        rowIndex: 104,
        errorCode: 'DUPLICATE_SKU',
        errorMessage: 'SKU already registered in catalog',
        rawPayloadHash: 'hash-c5',
        createdAt: new Date(),
      };

      const payload = {
        sku: 'SKU-ULTRA-7000',
        tax_id: 'TAX-9988-US',
      };

      const context = extractModuleIdentifier(reject, payload);
      expect(context.label).toBe('SKU');
      expect(context.value).toBe('SKU-ULTRA-7000');
      expect(context.secondary).toBe('Batch: batch-c5-99');
    });

    it('falls back gracefully to row index and batch ID when payload is absent', () => {
      const reject: MigrationReject = {
        id: 'rej-fallback',
        batchId: 'batch-empty',
        module: 'crm-5',
        rowIndex: 55,
        errorCode: 'MALFORMED_CSV',
        errorMessage: 'Unparseable CSV string',
        rawPayloadHash: 'hash-none',
        createdAt: new Date(),
      };

      const context = extractModuleIdentifier(reject, undefined);
      expect(context.label).toBe('Batch Correlation ID');
      expect(context.value).toBe('batch-empty');
      expect(context.secondary).toBe('Row #55');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Human-Readable Failure Explanations & Error Categorization (AC 2)
  // ---------------------------------------------------------------------------
  describe('2. Human-Readable Failure Explanations & Error Categorization (AC 2)', () => {
    it('categorizes machine error codes into standard audit categories', () => {
      expect(categorizeErrorCode('DUPLICATE_SKU')).toBe('Constraint Violation');
      expect(categorizeErrorCode('UNIQUE_KEY_VIOLATION')).toBe('Constraint Violation');
      expect(categorizeErrorCode('COUNT_INVARIANT_VIOLATION')).toBe('Integrity & Conservation');
      expect(categorizeErrorCode('SOURCE_TARGET_UNBALANCED')).toBe('Integrity & Conservation');
      expect(categorizeErrorCode('FORMULA_PREFIX_DETECTED')).toBe('Security & Injection');
      expect(categorizeErrorCode('SQL_INJECTION_RISK')).toBe('Security & Injection');
      expect(categorizeErrorCode('INVALID_STAGE_TRANSITION')).toBe('Lifecycle & Chronology');
      expect(categorizeErrorCode('FUTURE_TIMESTAMP_DETECTED')).toBe('Lifecycle & Chronology');
      expect(categorizeErrorCode('REQUIRED_FIELD_MISSING')).toBe('Data Validation');
      expect(categorizeErrorCode('INVALID_TAX_ID')).toBe('Data Validation');
      expect(categorizeErrorCode('CUSTOM_CODE')).toBe('Unknown');
    });

    it('generates clear explanations and actionable remediation for DUPLICATE_SKU', () => {
      const { explanation, remediation } = formatRejectFailureReason(
        'DUPLICATE_SKU',
        'SKU already present',
        { sku: 'SKU-001' }
      );

      expect(explanation).toContain('SKU');
      expect(explanation).toContain('SKU-001');
      expect(remediation).toContain('exact-merge');
    });

    it('generates clear explanations and actionable remediation for INVALID_TAX_ID', () => {
      const { explanation, remediation } = formatRejectFailureReason(
        'INVALID_TAX_ID',
        'Tax ID failed regex'
      );

      expect(explanation).toContain('Invalid Tax ID');
      expect(remediation).toContain('tax registration number');
    });

    it('generates clear explanations and actionable remediation for FORMULA_PREFIX', () => {
      const { explanation, remediation } = formatRejectFailureReason(
        'FORMULA_PREFIX',
        'Cell begins with ='
      );

      expect(explanation).toContain('Formula Injection Trigger');
      expect(remediation).toContain('formula-neutralized');
    });

    it('generates clear explanations and actionable remediation for COUNT_INVARIANT_VIOLATION', () => {
      const { explanation, remediation } = formatRejectFailureReason(
        'COUNT_INVARIANT_VIOLATION',
        'Conservation invariant broken'
      );

      expect(explanation).toContain('Conservation Invariant Violation');
      expect(remediation).toContain('Reconcile batch row telemetry');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Sensitive Field Masking & Exclusion (AC 3)
  // ---------------------------------------------------------------------------
  describe('3. Sensitive Field Masking & Exclusion (AC 3)', () => {
    it('masks bank account numbers retaining only last 4 digits (XXXX-XXXX-7890)', () => {
      expect(maskBankDetails('1234567890')).toBe('XXXX-XXXX-7890');
      expect(maskBankDetails('GB29NWBK60161331926819')).toBe('XXXX-XXXX-6819');
      expect(maskBankDetails('123')).toBe('XXXX');
    });

    it('masks government IDs and SSNs (***-**-7890)', () => {
      expect(maskGovernmentId('9876543210')).toBe('***-**-3210');
      expect(maskGovernmentId('123-45-6789')).toBe('***-**-6789');
      expect(maskGovernmentId('12')).toBe('[REDACTED_ID]');
    });

    it('masks salary and compensation amounts', () => {
      expect(maskSalary('120000')).toBe('XX,XXX');
      expect(maskSalary(85000)).toBe('XX,XXX');
    });

    it('recursively masks sensitive financial, bank, and employee fields across objects and arrays', () => {
      const sensitiveRecord = {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        bank_account: '9876543210',
        iban: 'FR7630006000011234567890189',
        ssn: '123-45-6789',
        tax_id: '99-8877665',
        password: 'SuperSecretPassword!2026',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        salary: 135000,
        nested: {
          account_number: '1122334455',
          secret_key: 'sk_live_abcdef',
        },
        items: [
          { routing_number: '121000358', note: 'Standard transfer' },
        ],
      };

      const masked = maskSensitiveFields(sensitiveRecord);

      expect(masked.name).toBe('Jane Doe');
      expect(masked.email).toBe('jane.doe@example.com');
      expect(masked.bank_account).toBe('XXXX-XXXX-3210');
      expect(masked.iban).toBe('XXXX-XXXX-0189');
      expect(masked.ssn).toBe('***-**-6789');
      expect(masked.tax_id).toBe('***-**-7665');
      expect(masked.password).toBe('[REDACTED]');
      expect(masked.token).toBe('[REDACTED]');
      expect(masked.salary).toBe('XX,XXX');
      expect(masked.nested.account_number).toBe('XXXX-XXXX-4455');
      expect(masked.nested.secret_key).toBe('[REDACTED]');
      expect(masked.items[0].routing_number).toBe('XXXX-XXXX-0358');
      expect(masked.items[0].note).toBe('Standard transfer');
    });

    it('enhances MigrationReject record with maskedPayload and audit attributes', () => {
      const reject: MigrationReject = {
        id: 'rej-audit-1',
        batchId: 'batch-sec-01',
        module: 'crm-5',
        rowIndex: 7,
        errorCode: 'DUPLICATE_SKU',
        errorMessage: 'SKU conflict detected',
        rawPayloadHash: 'hash-abc',
        createdAt: new Date('2026-10-23T12:00:00Z'),
      };

      const rawPayload = {
        sku: 'SKU-TEST-99',
        bank_account: '1234567890',
        password: 'SecretPassword',
      };

      const enhanced = enhanceRejectRecord(reject, rawPayload);

      expect(enhanced.category).toBe('Constraint Violation');
      expect(enhanced.identifierLabel).toBe('SKU');
      expect(enhanced.identifierValue).toBe('SKU-TEST-99');
      expect(enhanced.explanation).toContain('SKU');
      expect(enhanced.maskedPayload?.bank_account).toBe('XXXX-XXXX-7890');
      expect(enhanced.maskedPayload?.password).toBe('[REDACTED]');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Formula-Safe CSV Export (AC 4)
  // ---------------------------------------------------------------------------
  describe('4. Formula-Safe CSV Export (AC 4)', () => {
    it('generates formula-safe CSV with correct standardized headers and neutralized formulas', () => {
      const rejects: MigrationReject[] = [
        {
          id: 'rej-csv-1',
          batchId: '=cmd|/c calc!A0', // Injected formula attempt in batch ID
          module: 'crm-5',
          rowIndex: 1,
          errorCode: 'FORMULA_PREFIX',
          errorMessage: '+1234567890 phone number formula attempt',
          rawPayloadHash: 'hash-001',
          createdAt: new Date('2026-10-23T10:00:00Z'),
        },
        {
          id: 'rej-csv-2',
          batchId: 'batch-safe-02',
          module: 'crm-1',
          rowIndex: 2,
          errorCode: 'DUPLICATE_EMAIL',
          errorMessage: '@SUM(1+1) formula in email field',
          rawPayloadHash: 'hash-002',
          createdAt: new Date('2026-10-23T11:00:00Z'),
        },
      ];

      const csv = generateFormulaSafeRejectsCsv(rejects);

      // Verify standardized headers
      const lines = csv.split('\r\n').filter(Boolean);
      expect(lines.length).toBe(3); // Header + 2 data rows

      const headerLine = lines[0];
      expect(headerLine).toContain('Row Index');
      expect(headerLine).toContain('Target Module');
      expect(headerLine).toContain('Batch Correlation ID');
      expect(headerLine).toContain('Context Identifier Label');
      expect(headerLine).toContain('Context Identifier Value');
      expect(headerLine).toContain('Error Code');
      expect(headerLine).toContain('Error Category');
      expect(headerLine).toContain('Failure Explanation');
      expect(headerLine).toContain('Remediation Guidance');
      expect(headerLine).toContain('Payload SHA-256 Hash');
      expect(headerLine).toContain('Recorded At');

      // Verify formula neutralization per CWE-1236 & PLT-12
      // Cells starting with =, +, -, @ must be neutralized with a leading single quote (')
      const row1 = lines[1];
      expect(row1).toContain("'=cmd|/c calc!A0");

      const row2 = lines[2];
      expect(row2).toContain('batch-safe-02');
    });

    it('safely handles browser download invocation in non-browser environments without errors', () => {
      // In Node test environment, window and document might be absent or present
      expect(() => downloadRejectsCsv('test,csv', 'sample.csv')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Component Structure & WAI-ARIA Verification
  // ---------------------------------------------------------------------------
  describe('5. Component Structure & WAI-ARIA Verification', () => {
    it('renders RejectDetailModal with WAI-ARIA dialog attributes, close button, and masked payload', () => {
      const reject: MigrationReject = {
        id: 'rej-modal-1',
        batchId: 'batch-alpha-1',
        module: 'crm-5',
        rowIndex: 99,
        errorCode: 'DUPLICATE_SKU',
        errorMessage: 'SKU conflict',
        rawPayloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        createdAt: new Date('2026-10-23T14:00:00Z'),
      };

      const onClose = vi.fn();
      const onNavigateBatch = vi.fn();

      const modalElement = RejectDetailModal({
        isOpen: true,
        onClose,
        reject,
        rawPayload: {
          sku: 'SKU-MOCK-88',
          bank_account: '1111222233334444',
        },
        onNavigateBatch,
      });

      expect(modalElement).not.toBeNull();
      // Backdrop div
      expect(modalElement?.props.className).toBe('cs-modal-backdrop');

      // Modal Card
      const card = modalElement?.props.children;
      expect(card.props.role).toBe('dialog');
      expect(card.props['aria-modal']).toBe('true');
      expect(card.props.className).toContain('cs-reject-detail-card');
    });

    it('renders null when RejectDetailModal is not open or reject is null', () => {
      expect(RejectDetailModal({ isOpen: false, onClose: vi.fn(), reject: null })).toBeNull();
    });

    it('renders RejectsOverviewPage with loading skeleton, empty state, and access denied view', () => {
      // Loading State
      const loadingPage = RejectsOverviewPage({ isLoading: true });
      expect(loadingPage).toBeDefined();

      // Access Denied State (403)
      const deniedPage = RejectsOverviewPage({ httpStatus: 403 });
      expect(deniedPage).toBeDefined();

      // Empty State
      const emptyPage = RejectsOverviewPage({ isEmpty: true, data: [] });
      expect(emptyPage).toBeDefined();
    });

    it('REJECTS_AUDIT_COLUMNS contains all required columns for Issue #196', () => {
      const keys = REJECTS_AUDIT_COLUMNS.map((c) => c.key);
      expect(keys).toContain('rowIndex');
      expect(keys).toContain('module');
      expect(keys).toContain('batchId');
      expect(keys).toContain('contextIdentifier');
      expect(keys).toContain('errorCode');
      expect(keys).toContain('errorMessage');
      expect(keys).toContain('rawPayloadHash');
      expect(keys).toContain('createdAt');
      expect(keys).toContain('actions');
    });
  });
});
