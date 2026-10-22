/**
 * ClearShift Core - Formula-Safe CSV Export & Security Helpers
 * [PLT-12] Security baseline, secrets, dependency and export protections
 *
 * Traceability:
 * - ClearShift Project Plan v3.0 §§9.3-9.6, 17
 * - V1 Standardization Plan §12.3 (Security and Personal Data)
 * - CWE-1236: Improper Neutralization of Formula Elements in CSV File
 */

/**
 * SecurityError represents a validation or policy violation in core security functions.
 * Adheres to ClearShift standard error envelope: { code, message, statusCode }.
 */
export class SecurityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

/**
 * Standard resource safeguards for CSV & XLSX parsers and exporters.
 * Aligned with ClearShift V1 non-negotiable constraints:
 * - 50 MB max file size
 * - 500 rows per processing batch
 * - Stop processing if failures exceed 10%
 */
export const PARSER_RESOURCE_SAFEGUARDS = {
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50 MB
  MAX_ROW_COUNT: 50_000,
  MAX_CELL_LENGTH: 32_768, // 32 KB max per cell
  DEFAULT_CHUNK_SIZE: 500, // 500 rows per load chunk
  FAILURE_THRESHOLD_RATIO: 0.10, // 10% cumulative failure threshold
  ALLOWED_DELIMITERS: [",", ";", "\t"] as const,
  ALLOWED_EXTENSIONS: [".csv", ".xlsx"] as const
} as const;

/**
 * Characters that trigger formula execution in spreadsheet applications
 * (Excel, LibreOffice Calc, Google Sheets).
 * Per PLT-12 constraint: values beginning after leading whitespace with =, +, - or @
 * are neutralized in exported representation.
 */
export const FORMULA_PREFIX_REGEX = /^\s*[=+\-@]/;

/**
 * Neutralizes potentially dangerous spreadsheet formula injection triggers.
 * Prepends a single quote (') if the string begins with =, +, -, or @ after optional leading whitespace.
 *
 * Invariant: This is a pure function. Original input strings and objects are never mutated.
 *
 * @param value Cell value to neutralize
 * @returns Neutralized string safe for CSV representation
 */
export function neutralizeFormula(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  // Preserve non-string types directly (e.g. booleans, finite numbers)
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const str = String(value);

  // If already neutralized with leading single quote, do not double-quote
  if (str.startsWith("'")) {
    return str;
  }

  // If after leading whitespace the first character is =, +, -, or @
  if (FORMULA_PREFIX_REGEX.test(str)) {
    return `'${str}`;
  }

  return str;
}

export interface CsvFormatOptions {
  /**
   * Whether to neutralize formula injection characters. Default: true.
   */
  neutralizeFormulas?: boolean;
  /**
   * Delimiter character: comma or semicolon. Default: ","
   */
  delimiter?: "," | ";";
  /**
   * Line terminator. Default: "\r\n" (RFC 4180)
   */
  lineTerminator?: "\r\n" | "\n";
}

/**
 * Formats a single value into an RFC 4180 compliant, formula-safe CSV cell.
 *
 * @param rawValue Any cell value
 * @param options CSV formatting options
 * @returns RFC 4180 quoted and formula-neutralized CSV cell string
 */
export function formatCsvCell(rawValue: unknown, options: CsvFormatOptions = {}): string {
  const { neutralizeFormulas = true, delimiter = "," } = options;

  const value = neutralizeFormulas ? neutralizeFormula(rawValue) : (rawValue === null || rawValue === undefined ? "" : String(rawValue));

  // Determine if quotes are required:
  // Quotes are needed if cell contains delimiter, double quote, newline, carriage return,
  // or starts with single quote (from formula neutralization) to ensure standard spreadsheet parsing.
  const requiresQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.startsWith("'") ||
    value.startsWith(" ") ||
    value.endsWith(" ");

  if (requiresQuotes) {
    // RFC 4180: escape internal double quotes by doubling them (" -> "")
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return value;
}

/**
 * Formats an array of values into a single CSV row.
 *
 * @param values Array of cell values
 * @param options CSV formatting options
 * @returns Delimited row string
 */
export function formatCsvRow(values: unknown[], options: CsvFormatOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  return values.map((val) => formatCsvCell(val, options)).join(delimiter);
}

export interface ExportCsvOptions<T> extends CsvFormatOptions {
  /**
   * Explicit columns / keys to include in the export.
   */
  columns?: (keyof T | string)[];
  /**
   * Optional custom header labels corresponding to the columns.
   */
  headers?: string[];
}

/**
 * Exports an array of records to an RFC 4180 compliant, formula-safe CSV string.
 *
 * Strict Invariant: Stored source and target records are NEVER mutated.
 *
 * @param records Array of plain objects
 * @param options Export options (columns, headers, delimiter, etc.)
 * @returns Complete CSV string including header row
 */
export function exportCsvSafe<T extends Record<string, unknown>>(
  records: readonly T[],
  options: ExportCsvOptions<T> = {}
): string {
  const delimiter = options.delimiter ?? ",";
  const lineTerminator = options.lineTerminator ?? "\r\n";

  if (records.length === 0) {
    if (options.headers && options.headers.length > 0) {
      return formatCsvRow(options.headers, options);
    }
    if (options.columns && options.columns.length > 0) {
      return formatCsvRow(options.columns as string[], options);
    }
    return "";
  }

  // Derive columns
  const columns: string[] = options.columns
    ? (options.columns as string[])
    : Object.keys(records[0] ?? {});

  const headers: string[] = options.headers && options.headers.length === columns.length
    ? options.headers
    : columns;

  const lines: string[] = [];

  // Header row (headers are also passed through formatCsvRow to escape delimiters/quotes if needed)
  lines.push(formatCsvRow(headers, { ...options, neutralizeFormulas: false }));

  // Data rows
  for (const record of records) {
    const rowValues = columns.map((col) => record[col]);
    lines.push(formatCsvRow(rowValues, options));
  }

  return lines.join(lineTerminator);
}

/**
 * Escapes untrusted text for safe HTML rendering to prevent Cross-Site Scripting (XSS).
 * Payloads remain pure data and cannot execute as HTML/JavaScript.
 *
 * @param unsafe Untrusted input text
 * @returns HTML-entity escaped string
 */
export function escapeHtml(unsafe: string): string {
  if (typeof unsafe !== "string") {
    return unsafe === null || unsafe === undefined ? "" : String(unsafe);
  }

  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Enforces that dynamic SQL identifiers (table names, column names, sort fields)
 * match an explicit allow-list to prevent SQL injection.
 *
 * @param identifier The dynamic identifier requested
 * @param allowList Approved identifier list
 * @returns The validated safe identifier
 * @throws SecurityError if identifier is not in the allow-list or contains illegal characters
 */
export function assertSafeSqlIdentifier(
  identifier: string,
  allowList: readonly string[]
): string {
  if (typeof identifier !== "string" || !identifier) {
    throw new SecurityError(
      "INVALID_SQL_IDENTIFIER",
      "SQL identifier must be a non-empty string",
      400
    );
  }

  // Strict identifier pattern: only alphanumeric and underscores allowed
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new SecurityError(
      "MALFORMED_SQL_IDENTIFIER",
      `Dynamic SQL identifier '${identifier}' contains invalid characters`,
      400
    );
  }

  if (!allowList.includes(identifier)) {
    throw new SecurityError(
      "UNAUTHORIZED_SQL_IDENTIFIER",
      `Dynamic SQL identifier '${identifier}' is not in the approved allow-list`,
      403
    );
  }

  return identifier;
}

/**
 * Validates file size and row limits against parser resource safeguards.
 *
 * @param fileSizeBytes Size of the file in bytes
 * @param rowCount Optional count of rows in the file
 * @throws SecurityError if any threshold is exceeded
 */
export function validateParserResourceLimits(fileSizeBytes: number, rowCount?: number): void {
  if (fileSizeBytes > PARSER_RESOURCE_SAFEGUARDS.MAX_FILE_SIZE_BYTES) {
    const maxMb = PARSER_RESOURCE_SAFEGUARDS.MAX_FILE_SIZE_BYTES / (1024 * 1024);
    const actualMb = (fileSizeBytes / (1024 * 1024)).toFixed(2);
    throw new SecurityError(
      "FILE_SIZE_LIMIT_EXCEEDED",
      `File size (${actualMb} MB) exceeds maximum allowed ceiling of ${maxMb} MB`,
      413
    );
  }

  if (rowCount !== undefined && rowCount > PARSER_RESOURCE_SAFEGUARDS.MAX_ROW_COUNT) {
    throw new SecurityError(
      "ROW_LIMIT_EXCEEDED",
      `Row count (${rowCount}) exceeds maximum allowed ceiling of ${PARSER_RESOURCE_SAFEGUARDS.MAX_ROW_COUNT} rows`,
      400
    );
  }
}
