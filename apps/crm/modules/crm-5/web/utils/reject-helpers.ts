import type { CrmModule, MigrationReject } from '@clearshift/contracts';
import { exportCsvSafe, neutralizeFormula } from '@cs/core';

/**
 * Standardized Rejection Error Categories
 */
export type RejectErrorCategory =
  | 'Data Validation'
  | 'Constraint Violation'
  | 'Integrity & Conservation'
  | 'Security & Injection'
  | 'Lifecycle & Chronology'
  | 'Unknown';

export interface ModuleIdentifierContext {
  label: string;
  value: string;
  secondary?: string;
  deepLink?: string;
}

export interface EnhancedRejectRecord extends MigrationReject {
  category: RejectErrorCategory;
  identifierLabel: string;
  identifierValue: string;
  secondary?: string;
  explanation: string;
  remediation: string;
  maskedPayload?: Record<string, unknown>;
}

// Regex patterns for field detection (aligned with @cs/core PLT-06 / PLT-12)
const SECRET_FIELD_REGEX =
  /^(?:password|passwd|pass|argon2hash|passwordhash|secret(?:_?key)?|jwt|token|refreshtoken|tokenhash|privateenc|signing_?key|private_?key|client_?secret|authorization|api_?key)$/i;
const BANK_FIELD_REGEX =
  /^(?:bank_?account|account_?number|iban|routing_?number|swift|cvv|card_?number)$/i;
const GOVT_ID_REGEX = /^(?:ssn|tax_?id|national_?id|aadhaar|pan|identity_?number)$/i;
const SALARY_FIELD_REGEX = /^(?:salary|base_?salary|compensation|wage|hourly_?rate)$/i;

/**
 * Categorizes machine error codes into high-level audit categories.
 */
export function categorizeErrorCode(code: string): RejectErrorCategory {
  const normalized = (code ?? '').toUpperCase();

  if (
    normalized.includes('DUPLICATE') ||
    normalized.includes('CONFLICT') ||
    normalized.includes('CONSTRAINT') ||
    normalized.includes('UNIQUE')
  ) {
    return 'Constraint Violation';
  }

  if (
    normalized.includes('INVARIANT') ||
    normalized.includes('CONSERVATION') ||
    normalized.includes('UNBALANCED') ||
    normalized.includes('COUNT')
  ) {
    return 'Integrity & Conservation';
  }

  if (
    normalized.includes('FORMULA') ||
    normalized.includes('INJECTION') ||
    normalized.includes('SECURITY') ||
    normalized.includes('UNAUTHORIZED')
  ) {
    return 'Security & Injection';
  }

  if (
    normalized.includes('CHRONOLOGY') ||
    normalized.includes('TRANSITION') ||
    normalized.includes('TIMESTAMP') ||
    normalized.includes('LIFECYCLE')
  ) {
    return 'Lifecycle & Chronology';
  }

  if (
    normalized.includes('REQUIRED') ||
    normalized.includes('MISSING') ||
    normalized.includes('INVALID') ||
    normalized.includes('MALFORMED') ||
    normalized.includes('OUT_OF_BOUNDS') ||
    normalized.includes('SCHEMA')
  ) {
    return 'Data Validation';
  }

  return 'Unknown';
}

/**
 * Resolves module-specific identifier columns according to ClearShift CRM domain standards.
 * - CRM-1: Contact ID / Email / Company
 * - CRM-2: Deal ID / Quote Number / Pipeline
 * - CRM-3: Ticket ID / Account Number
 * - CRM-4: Campaign ID / Lead ID
 * - CRM-5: Batch Correlation ID / SKU / Tax ID
 */
export function extractModuleIdentifier(
  reject: MigrationReject,
  rawPayload?: Record<string, unknown>
): ModuleIdentifierContext {
  const mod = reject.module as CrmModule;
  const p = rawPayload ?? {};

  switch (mod) {
    case 'crm-1': {
      const contactId = (p['contact_id'] ?? p['contactId'] ?? p['id']) as string | undefined;
      const email = (p['email'] ?? p['operator_email'] ?? p['operatorEmail']) as string | undefined;
      const company = (p['company_name'] ?? p['company_id'] ?? p['companyId']) as string | undefined;

      const primaryValue = contactId || email || `row-${reject.rowIndex}`;
      const primaryLabel = contactId ? 'Contact ID' : email ? 'Email' : 'Row Ref';
      const secondary = email && contactId ? email : company ? `Company: ${company}` : undefined;

      return {
        label: primaryLabel,
        value: String(primaryValue),
        secondary,
        deepLink: `/crm-1/contacts?search=${encodeURIComponent(primaryValue)}`,
      };
    }

    case 'crm-2': {
      const dealId = (p['deal_id'] ?? p['dealId'] ?? p['id']) as string | undefined;
      const quoteNo = (p['quote_number'] ?? p['quoteNumber']) as string | undefined;
      const pipeline = (p['pipeline_id'] ?? p['pipelineId'] ?? p['stage']) as string | undefined;

      const primaryValue = dealId || quoteNo || `row-${reject.rowIndex}`;
      const primaryLabel = dealId ? 'Deal ID' : quoteNo ? 'Quote #' : 'Row Ref';
      const secondary = quoteNo && dealId ? `Quote: ${quoteNo}` : pipeline ? `Stage: ${pipeline}` : undefined;

      return {
        label: primaryLabel,
        value: String(primaryValue),
        secondary,
        deepLink: `/crm-2/deals?search=${encodeURIComponent(primaryValue)}`,
      };
    }

    case 'crm-3': {
      const ticketId = (p['ticket_id'] ?? p['ticketId'] ?? p['id']) as string | undefined;
      const accountId = (p['account_id'] ?? p['accountId'] ?? p['account_number']) as string | undefined;

      const primaryValue = ticketId || accountId || `row-${reject.rowIndex}`;
      const primaryLabel = ticketId ? 'Ticket ID' : accountId ? 'Account #' : 'Row Ref';
      const secondary = accountId && ticketId ? `Account: ${accountId}` : undefined;

      return {
        label: primaryLabel,
        value: String(primaryValue),
        secondary,
        deepLink: `/crm-3/tickets?search=${encodeURIComponent(primaryValue)}`,
      };
    }

    case 'crm-4': {
      const campaignId = (p['campaign_id'] ?? p['campaignId'] ?? p['id']) as string | undefined;
      const leadId = (p['lead_id'] ?? p['leadId']) as string | undefined;

      const primaryValue = campaignId || leadId || `row-${reject.rowIndex}`;
      const primaryLabel = campaignId ? 'Campaign ID' : leadId ? 'Lead ID' : 'Row Ref';
      const secondary = leadId && campaignId ? `Lead: ${leadId}` : undefined;

      return {
        label: primaryLabel,
        value: String(primaryValue),
        secondary,
        deepLink: `/crm-4/campaigns?search=${encodeURIComponent(primaryValue)}`,
      };
    }

    case 'crm-5':
    default: {
      const sku = (p['sku'] ?? p['product_sku'] ?? p['item_sku']) as string | undefined;
      const taxId = (p['tax_id'] ?? p['taxId'] ?? p['vat_number']) as string | undefined;
      const batchId = reject.batchId;

      if (sku) {
        return {
          label: 'SKU',
          value: String(sku),
          secondary: `Batch: ${batchId}`,
          deepLink: `/crm-5/runs?search=${encodeURIComponent(batchId)}`,
        };
      }

      if (taxId) {
        const maskedTax = maskGovernmentId(taxId);
        return {
          label: 'Tax ID',
          value: maskedTax,
          secondary: `Batch: ${batchId}`,
          deepLink: `/crm-5/runs?search=${encodeURIComponent(batchId)}`,
        };
      }

      return {
        label: 'Batch Correlation ID',
        value: batchId,
        secondary: `Row #${reject.rowIndex}`,
        deepLink: `/crm-5/runs?search=${encodeURIComponent(batchId)}`,
      };
    }
  }
}

/**
 * Generates human-readable, actionable failure explanations based on error codes and message context.
 */
export function formatRejectFailureReason(
  errorCode: string,
  rawErrorMessage?: string,
  context?: Record<string, unknown>
): { explanation: string; remediation: string } {
  const code = (errorCode ?? '').toUpperCase();
  const rawMsg = rawErrorMessage ?? '';
  const ctx = context ?? {};

  switch (code) {
    case 'DUPLICATE_SKU': {
      const sku = (ctx['sku'] ?? ctx['identifier'] ?? 'specified item') as string;
      return {
        explanation: `Duplicate SKU '${sku}': Natural product identifier already exists in target inventory partition.`,
        remediation: 'Inspect existing SKU in target inventory. Update source catalog or route record to exact-merge workflow.',
      };
    }

    case 'INVALID_TAX_ID': {
      return {
        explanation: 'Invalid Tax ID: Identification format failed national checksum verification or contained illegal characters.',
        remediation: 'Verify entity tax registration number format against national authority rules (e.g., VAT/EIN checksum).',
      };
    }

    case 'DUPLICATE_KEY':
    case 'EXACT_DUPLICATE': {
      return {
        explanation: rawMsg || 'Duplicate Key: Record replicates existing primary or unique natural key in target database.',
        remediation: 'Check duplicate candidate queue. Confirm if record should be deduplicated or updated via approved merge path.',
      };
    }

    case 'COUNT_INVARIANT_VIOLATION': {
      return {
        explanation: 'Conservation Invariant Violation: Sum of migrated records (recordsOut) and rejected records exceeds total source records (recordsIn).',
        remediation: 'Reconcile batch row telemetry counts. Ensure total processed equals source records without row duplication.',
      };
    }

    case 'FORMULA_PREFIX': {
      return {
        explanation: "Formula Injection Trigger: Input cell starts with dangerous spreadsheet prefix (=, +, -, or @) in violation of CWE-1236.",
        remediation: 'Sanitize spreadsheet cell content before ingestion or use formula-neutralized text export.',
      };
    }

    case 'REQUIRED_FIELD_MISSING': {
      return {
        explanation: rawMsg || 'Mandatory Field Missing: One or more non-nullable entity attributes are blank or omitted.',
        remediation: 'Ensure all required fields (e.g. batchId, module, step) contain non-empty values.',
      };
    }

    case 'FOREIGN_KEY_MISSING': {
      return {
        explanation: rawMsg || 'Foreign Key Missing: Referenced parent record or correlation batch does not exist in target database.',
        remediation: 'Confirm parent batch exists in Migration Kit registry before processing child events.',
      };
    }

    case 'MALFORMED_UUID': {
      return {
        explanation: 'Malformed UUID: Unique identifier does not match RFC-4122 canonical 36-character hexadecimal format.',
        remediation: 'Generate valid v4 UUID or permit ingestion engine to assign defaultRandom() UUID.',
      };
    }

    case 'INVALID_ENUM_VALUE': {
      return {
        explanation: rawMsg || 'Invalid Enum Value: Specified value is not included in the approved domain allowlist.',
        remediation: 'Map source attribute to valid system enum values (e.g. crm-1..crm-5, pending/running/completed).',
      };
    }

    case 'INVALID_TIMESTAMP': {
      return {
        explanation: 'Invalid Timestamp: Date value fails ISO-8601 parsing (YYYY-MM-DDThh:mm:ss[.fff]Z).',
        remediation: 'Format all timestamp columns as valid ISO-8601 strings with explicit UTC (Z) or timezone offset.',
      };
    }

    case 'CHRONOLOGY_VIOLATION': {
      return {
        explanation: 'Chronology Invariant Violation: Process completion timestamp precedes execution start timestamp.',
        remediation: 'Verify worker system clocks and ensure completedAt occurs after startedAt.',
      };
    }

    case 'OUT_OF_BOUNDS': {
      return {
        explanation: rawMsg || 'Numeric Value Out of Bounds: Integer or decimal value falls outside permissible boundary limits.',
        remediation: 'Ensure integer counts are non-negative 32-bit values and sampling rates fall within 0.00 to 1.00.',
      };
    }

    case 'MALFORMED_JSON': {
      return {
        explanation: 'Malformed JSON Payload: Metadata or JSON column contains syntactically invalid serialized string.',
        remediation: 'Validate JSON structure and escape quotation characters prior to load.',
      };
    }

    default: {
      return {
        explanation: rawMsg || `Rejection recorded under code '${errorCode}'.`,
        remediation: 'Review raw payload hash audit log and apply data cleaning rule in Migration Kit.',
      };
    }
  }
}

/**
 * Masks bank account numbers to XXXX-XXXX-7890 format.
 */
export function maskBankDetails(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  if (str === '') return '';
  const digits = str.replace(/\D/g, '');
  if (digits.length < 4) return 'XXXX';
  const last4 = digits.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/**
 * Masks government identifiers (SSN, Tax ID, National ID) to ***-**-7890 format.
 */
export function maskGovernmentId(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 4) {
    const last4 = digits.slice(-4);
    return `***-**-${last4}`;
  }
  return '[REDACTED_ID]';
}

/**
 * Masks salary or compensation figures to 'XX,XXX'.
 */
export function maskSalary(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'salary hidden';
  return 'XX,XXX';
}

/**
 * Automatically masks sensitive financial, bank, tax, and employee compensation fields
 * from review views and exports in compliance with ClearShift Security Baseline (PLT-06 / PLT-12).
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(record: T): T {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    // 1. Passwords, Tokens, API Keys, Secrets
    if (SECRET_FIELD_REGEX.test(key)) {
      result[key] = '[REDACTED]';
      continue;
    }

    // 2. Bank Accounts, IBANs, Routing Numbers
    if (BANK_FIELD_REGEX.test(key)) {
      result[key] = maskBankDetails(value);
      continue;
    }

    // 3. Tax IDs, SSNs, National Government IDs
    if (GOVT_ID_REGEX.test(key)) {
      result[key] = maskGovernmentId(value);
      continue;
    }

    // 4. Salaries, Wages, Compensation
    if (SALARY_FIELD_REGEX.test(key)) {
      result[key] = maskSalary(value);
      continue;
    }

    // 5. Recursive masking for nested objects and arrays
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item && typeof item === 'object' && !(item instanceof Date)
            ? maskSensitiveFields(item as Record<string, unknown>)
            : item
        );
      } else {
        result[key] = maskSensitiveFields(value as Record<string, unknown>);
      }
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Enhances a raw MigrationReject record with full audit context, module identifier,
 * human-readable failure explanation, and masked payload representation.
 */
export function enhanceRejectRecord(
  reject: MigrationReject,
  rawPayload?: Record<string, unknown>
): EnhancedRejectRecord {
  const category = categorizeErrorCode(reject.errorCode);
  const identifier = extractModuleIdentifier(reject, rawPayload);
  const { explanation, remediation } = formatRejectFailureReason(
    reject.errorCode,
    reject.errorMessage,
    rawPayload
  );

  const maskedPayload = rawPayload ? maskSensitiveFields(rawPayload) : undefined;

  return {
    ...reject,
    category,
    identifierLabel: identifier.label,
    identifierValue: identifier.value,
    secondary: identifier.secondary,
    explanation,
    remediation,
    maskedPayload,
  };
}

/**
 * Generates an RFC-4180 compliant, formula-safe CSV export string from an array of reject records.
 * Neutralizes spreadsheet formula injection characters (=, +, -, @) per CWE-1236 & PLT-12.
 */
export function generateFormulaSafeRejectsCsv(
  rejects: readonly MigrationReject[],
  payloadMap?: Record<string, Record<string, unknown>>
): string {
  const headers = [
    'Row Index',
    'Target Module',
    'Batch Correlation ID',
    'Context Identifier Label',
    'Context Identifier Value',
    'Error Code',
    'Error Category',
    'Failure Explanation',
    'Remediation Guidance',
    'Payload SHA-256 Hash',
    'Masked Payload Sample',
    'Recorded At',
  ];

  const exportRows = rejects.map((r) => {
    const rawPayload = payloadMap ? payloadMap[r.id] : undefined;
    const enhanced = enhanceRejectRecord(r, rawPayload);

    const maskedSample = enhanced.maskedPayload
      ? JSON.stringify(enhanced.maskedPayload)
      : '';

    return {
      'Row Index': r.rowIndex,
      'Target Module': r.module,
      'Batch Correlation ID': r.batchId,
      'Context Identifier Label': enhanced.identifierLabel,
      'Context Identifier Value': enhanced.identifierValue,
      'Error Code': r.errorCode,
      'Error Category': enhanced.category,
      'Failure Explanation': enhanced.explanation,
      'Remediation Guidance': enhanced.remediation,
      'Payload SHA-256 Hash': r.rawPayloadHash,
      'Masked Payload Sample': maskedSample,
      'Recorded At': r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    };
  });

  return exportCsvSafe(exportRows, {
    headers,
    neutralizeFormulas: true,
  });
}

/**
 * Safely triggers client-side browser download of the formula-safe CSV text string.
 */
export function downloadRejectsCsv(csvContent: string, filename = 'crm5-rejection-audit.csv'): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.setAttribute('download', filename);
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}
