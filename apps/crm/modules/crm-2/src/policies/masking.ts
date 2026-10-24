/**
 * Field-level Masking & Sanitization Policy for CRM-2
 * Enforces non-negotiable ClearShift privacy, log safety, and export rules.
 */

const TOKEN_REGEX = /(?:bearer\s+[a-zA-Z0-9_\-.]+|ghp_[a-zA-Z0-9]{36}|cs_[a-zA-Z0-9_]{32,})/gi;
const SENSITIVE_KEY_REGEX = /^(?:password|token|secret|credential|bank_?account|bank_?number|account_?number|iban|routing_?number|salary|compensation|ssn|national_?id|credit_?card)/i;

/**
 * Masks a bank account/card value to the format XXXX-XXXX-7890.
 * Preserves the last 4 digits of the identifier.
 */
export function maskBankDetails(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) {
    return 'XXXX-XXXX-XXXX';
  }
  const last4 = digits.slice(-4);
  return `XXXX-XXXX-${last4}`;
}

/**
 * Masks salary/compensation values to the format "XX,XXX" or "salary hidden".
 */
export function maskSalary(value: unknown): string {
  if (value === undefined || value === null) {
    return 'salary hidden';
  }
  return 'XX,XXX';
}

/**
 * Neutralizes CSV formula injection vulnerabilities (CSV injection / formula execution).
 * If a field starts with '=', '+', '-', '@', '\t', or '\r', prefixes with an apostrophe.
 */
export function sanitizeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value);
  if (/^[=+\-@\t\r]/.test(stringValue) || /^[=+\-@]/.test(stringValue.trimStart())) {
    return `'${stringValue}`;
  }
  return stringValue;
}

/**
 * Recursively redacts and masks sensitive properties in data objects before serialization or audit logging.
 * Replaces credentials, raw tokens, bank details, and salary values while preserving standard identifiers.
 */
export function redactSensitiveObject<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (input instanceof Date) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitiveObject(item)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      if (/bank|account_?number|iban|credit_?card|ssn/i.test(key) && typeof val === 'string') {
        result[key] = maskBankDetails(val);
      } else if (/salary|compensation/i.test(key)) {
        result[key] = maskSalary(val);
      } else {
        result[key] = '[REDACTED]';
      }
    } else {
      result[key] = redactSensitiveObject(val);
    }
  }

  return result as T;
}

/**
 * Sanitizes application log messages so credentials, tokens, raw rows, bank numbers,
 * and salaries are never leaked in log output.
 */
export function maskSensitiveLog(message: string): string {
  if (!message) return '';
  let sanitized = message.replace(TOKEN_REGEX, '[REDACTED_TOKEN]');
  sanitized = sanitized.replace(/(?:password|secret|token|credential)\s*[:=]\s*["']?[^"',\s]+["']?/gi, '$1=[REDACTED]');
  // Match explicit 16-digit card / bank groupings (e.g. 1234-5678-9012-3456 or 1234 5678 9012 3456)
  sanitized = sanitized.replace(/\b(?:\d{4}[ -]){3}(\d{4})\b/g, (_match, last4) => `XXXX-XXXX-${last4}`);
  sanitized = sanitized.replace(/\b(?:salary|compensation|remuneration)\b\s*[:=]\s*["']?\d+[\d,.]*["']?/gi, 'salary: XX,XXX');
  return sanitized;
}
