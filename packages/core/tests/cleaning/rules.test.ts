import { describe, it, expect } from "vitest";
import {
  RlText01Rule,
  RlText02Rule,
  RlName01Rule,
  RlEmail01Rule,
  RlPhone01Rule,
  RlDate01Rule,
  RlCurrency01Rule,
  RlAddr01Rule,
  RlReq01Rule,
  RlFormat01Rule,
  RlDup01Rule,
  RlTax01Rule,
} from "../../src/cleaning/index.js";
import type { CleaningRuleContext } from "../../src/cleaning/types.js";

function makeContext(fieldName: string, isRequired = false, overrides: Partial<CleaningRuleContext> = {}): CleaningRuleContext {
  return {
    batchId: "11111111-1111-4111-8111-111111111111",
    sourceRow: 1,
    fieldName,
    isRequired,
    dateFormat: "YYYY-MM-DD",
    phoneCountry: "+1",
    ...overrides,
  };
}

describe("V1 Cleaning Rules (SDS §3.4)", () => {
  describe("RL-TEXT-01: Whitespace Normalizer", () => {
    const rule = new RlText01Rule();

    it("trims leading and trailing spaces", () => {
      const res = rule.apply("   hello world   ", makeContext("title"));
      expect(res.newValue).toBe("hello world");
      expect(res.modified).toBe(true);
      expect(res.isValid).toBe(true);
    });

    it("collapses multiple consecutive internal whitespace characters", () => {
      const res = rule.apply("Acme\t\tCorp    Enterprises", makeContext("company"));
      expect(res.newValue).toBe("Acme Corp Enterprises");
      expect(res.modified).toBe(true);
    });

    it("leaves already clean text unchanged", () => {
      const res = rule.apply("Clean Company", makeContext("company"));
      expect(res.newValue).toBe("Clean Company");
      expect(res.modified).toBe(false);
    });
  });

  describe("RL-TEXT-02: Control Character Sanitizer", () => {
    const rule = new RlText02Rule();

    it("strips non-printable ASCII control characters and BOM", () => {
      const res = rule.apply("\uFEFFHello\x00\x08World\x1F!", makeContext("name"));
      expect(res.newValue).toBe("HelloWorld!");
      expect(res.modified).toBe(true);
      expect(res.isValid).toBe(true);
    });

    it("preserves standard printable strings", () => {
      const res = rule.apply("Valid Standard String", makeContext("desc"));
      expect(res.newValue).toBe("Valid Standard String");
      expect(res.modified).toBe(false);
    });
  });

  describe("RL-NAME-01: Name Proper Casing", () => {
    const rule = new RlName01Rule();

    it("capitalizes standard lowercase names", () => {
      const res = rule.apply("john smith", makeContext("first_name"));
      expect(res.newValue).toBe("John Smith");
      expect(res.modified).toBe(true);
    });

    it("handles O' prefix (O'Brien, O'Connor)", () => {
      const res = rule.apply("john o'brien", makeContext("name"));
      expect(res.newValue).toBe("John O'Brien");
    });

    it("handles Mc prefix (mcdonald -> McDonald)", () => {
      const res = rule.apply("ronald mcdonald", makeContext("name"));
      expect(res.newValue).toBe("Ronald McDonald");
    });

    it("handles lowercase particles in multi-word surnames", () => {
      const res = rule.apply("vincent van der sar", makeContext("name"));
      expect(res.newValue).toBe("Vincent van der Sar");
    });

    it("handles hyphenated names", () => {
      const res = rule.apply("mary-jane watson", makeContext("name"));
      expect(res.newValue).toBe("Mary-Jane Watson");
    });
  });

  describe("RL-EMAIL-01: Email Sanitizer & Validator (TS-05)", () => {
    const rule = new RlEmail01Rule();

    it("normalizes casing and trims whitespace", () => {
      const res = rule.apply("  User@Example.COM  ", makeContext("email", true));
      expect(res.newValue).toBe("user@example.com");
      expect(res.modified).toBe(true);
      expect(res.isValid).toBe(true);
      expect(res.rejectRow).toBe(false);
    });

    it("rejects required row with TS-05 exact message when @ is missing", () => {
      const res = rule.apply("invalid-email.com", makeContext("email", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("INVALID_EMAIL");
      expect(res.rejectReasonText).toBe("Email is not valid: value has no @ sign");
    });

    it("rejects required row when multiple @ signs exist", () => {
      const res = rule.apply("user@@example.com", makeContext("email", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonText).toBe("Email is not valid: value contains multiple @ signs");
    });

    it("rejects required row when domain lacks a dot", () => {
      const res = rule.apply("user@localhost", makeContext("email", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonText).toBe("Email is not valid: domain has no dot");
    });

    it("flags warning on optional field without rejecting the row", () => {
      const res = rule.apply("no-at-sign", makeContext("alt_email", false));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(false);
      expect(res.flagWarning).toBeDefined();
    });
  });

  describe("RL-PHONE-01: Phone Number Standardization", () => {
    const rule = new RlPhone01Rule();

    it("normalizes formatted phone number and preserves leading plus", () => {
      const res = rule.apply("+1 (555) 123-4567", makeContext("phone"));
      expect(res.newValue).toBe("+15551234567");
      expect(res.isValid).toBe(true);
    });

    it("prepends declared file country code to 10-digit national number", () => {
      const res = rule.apply("5551234567", makeContext("phone", false, { phoneCountry: "+1" }));
      expect(res.newValue).toBe("+15551234567");
      expect(res.isValid).toBe(true);
    });

    it("rejects required row if no digits are present", () => {
      const res = rule.apply("N/A", makeContext("phone", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("INVALID_PHONE");
    });
  });

  describe("RL-DATE-01: Date Parser & ISO-8601 Normalizer", () => {
    const rule = new RlDate01Rule();

    it("parses and standardizes YYYY-MM-DD", () => {
      const res = rule.apply("2026-10-23", makeContext("closed_date"));
      expect(res.newValue).toBe("2026-10-23");
      expect(res.isValid).toBe(true);
    });

    it("parses and standardizes DD-MM-YYYY format", () => {
      const res = rule.apply("25-12-2025", makeContext("created_date", false, { dateFormat: "DD-MM-YYYY" }));
      expect(res.newValue).toBe("2025-12-25");
      expect(res.isValid).toBe(true);
    });

    it("parses and standardizes MM/DD/YYYY format", () => {
      const res = rule.apply("10/23/2026", makeContext("deal_date", false, { dateFormat: "MM/DD/YYYY" }));
      expect(res.newValue).toBe("2026-10-23");
      expect(res.isValid).toBe(true);
    });

    it("rejects required row when date format is invalid", () => {
      const res = rule.apply("invalid-date", makeContext("due_date", true, { dateFormat: "YYYY-MM-DD" }));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("INVALID_DATE");
      expect(res.rejectReasonText).toContain("Date is not valid: expected format 'YYYY-MM-DD'");
    });
  });

  describe("RL-CURRENCY-01: Monetary Amount Normalization", () => {
    const rule = new RlCurrency01Rule();

    it("strips dollar signs and thousand commas to exact 2-decimal string", () => {
      const res = rule.apply("$1,250,500.50", makeContext("revenue"));
      expect(res.newValue).toBe("1250500.50");
      expect(res.isValid).toBe(true);
    });

    it("handles euro symbols and European dot-comma formatting", () => {
      const res = rule.apply("€ 2.500,75", makeContext("budget"));
      expect(res.newValue).toBe("2500.75");
      expect(res.isValid).toBe(true);
    });

    it("handles negative financial numbers with parentheses", () => {
      const res = rule.apply("($500.00)", makeContext("balance"));
      expect(res.newValue).toBe("-500.00");
      expect(res.isValid).toBe(true);
    });

    it("rejects required field with unparseable currency string", () => {
      const res = rule.apply("free-tier", makeContext("revenue", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("INVALID_CURRENCY");
    });
  });

  describe("RL-ADDR-01: City & Country Dictionary Standardization", () => {
    const rule = new RlAddr01Rule();

    it("standardizes legacy city name (Bombay -> Mumbai)", () => {
      const res = rule.apply("Bombay", makeContext("city"));
      expect(res.newValue).toBe("Mumbai");
      expect(res.modified).toBe(true);
    });

    it("standardizes country abbreviation (US -> United States)", () => {
      const res = rule.apply("USA", makeContext("country"));
      expect(res.newValue).toBe("United States");
      expect(res.modified).toBe(true);
    });

    it("respects custom dictionary overrides", () => {
      const customDict = { sfo: "San Francisco International" };
      const res = rule.apply("sfo", makeContext("city", false, { addressDictionary: customDict }));
      expect(res.newValue).toBe("San Francisco International");
    });
  });

  describe("RL-REQ-01: Required Fields Completeness Check", () => {
    const rule = new RlReq01Rule();

    it("passes when required field is populated", () => {
      const res = rule.apply("Acme Corp", makeContext("company", true));
      expect(res.isValid).toBe(true);
      expect(res.rejectRow).toBe(false);
    });

    it("rejects row with REQUIRED_FIELD_MISSING when required field is empty string", () => {
      const res = rule.apply("   ", makeContext("first_name", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("REQUIRED_FIELD_MISSING");
      expect(res.rejectReasonText).toBe("Required field 'first_name' is missing or empty");
    });

    it("rejects row with REQUIRED_FIELD_MISSING when required field is null", () => {
      const res = rule.apply(null, makeContext("company", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("REQUIRED_FIELD_MISSING");
      expect(res.rejectReasonText).toBe("Required field 'company' is missing or empty");
    });
  });

  describe("RL-FORMAT-01: Generic Format Validator", () => {
    const rule = new RlFormat01Rule();

    it("validates correct ISO date string", () => {
      const res = rule.apply("2026-10-23", makeContext("created_date", true));
      expect(res.isValid).toBe(true);
    });

    it("rejects required field with invalid format", () => {
      const res = rule.apply("not-a-date", makeContext("created_date", true));
      expect(res.isValid).toBe(false);
      expect(res.rejectRow).toBe(true);
      expect(res.rejectReasonCode).toBe("INVALID_FORMAT");
    });
  });

  describe("RL-DUP-01: Duplicate Key Normalizer", () => {
    const rule = new RlDup01Rule();

    it("normalizes email key for exact matching", () => {
      const res = rule.apply("  John.Doe@Example.COM ", makeContext("email"));
      expect(res.newValue).toBe("john.doe@example.com");
    });

    it("normalizes phone key for exact matching", () => {
      const res = rule.apply("+1 (555) 123-4567", makeContext("phone"));
      expect(res.newValue).toBe("+15551234567");
    });
  });

  describe("RL-TAX-01: Tax Identifier & Uncertainty Flagging", () => {
    const rule = new RlTax01Rule();

    it("normalizes recognized US EIN format", () => {
      const res = rule.apply("12-3456789", makeContext("tax_id"));
      expect(res.newValue).toBe("12-3456789");
      expect(res.isValid).toBe(true);
      expect(res.flagWarning).toBeUndefined();
    });

    it("normalizes recognized European VAT format", () => {
      const res = rule.apply("DE 123456789", makeContext("vat_number"));
      expect(res.newValue).toBe("DE123456789");
      expect(res.isValid).toBe(true);
    });

    it("flags 'unknown' instead of rejecting when format is uncertain (SDS RL-TAX-01)", () => {
      const res = rule.apply("TAX??123", makeContext("tax_id", false));
      expect(res.isValid).toBe(true);
      expect(res.rejectRow).toBe(false);
      expect(res.flagWarning).toBeDefined();
    });
  });
});
