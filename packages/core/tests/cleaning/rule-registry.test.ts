import { describe, it, expect } from "vitest";
import { CleaningRuleRegistry } from "../../src/cleaning/rule-registry.js";

describe("CleaningRuleRegistry (KIT-04)", () => {
  it("initializes with all 12 V1 rules enabled by default", () => {
    const registry = new CleaningRuleRegistry();
    const rules = registry.getRegisteredRules();
    expect(rules).toHaveLength(12);

    for (const rule of rules) {
      expect(registry.isRuleEnabled(rule.id)).toBe(true);
    }
  });

  it("allows switching rules on and off for a run", () => {
    const registry = new CleaningRuleRegistry({
      disabledRules: ["RL-NAME-01", "RL-ADDR-01"],
    });

    expect(registry.isRuleEnabled("RL-NAME-01")).toBe(false);
    expect(registry.isRuleEnabled("RL-ADDR-01")).toBe(false);
    expect(registry.isRuleEnabled("RL-EMAIL-01")).toBe(true);

    // Toggle rule back on
    registry.setRuleEnabled("RL-NAME-01", true);
    expect(registry.isRuleEnabled("RL-NAME-01")).toBe(true);
  });

  it("cleans a complete valid row and records field audit entries", () => {
    const registry = new CleaningRuleRegistry();

    const rawRow = {
      first_name: "  john  ",
      last_name: "o'brien",
      email: "John.OBrien@Example.COM  ",
      phone: "5551234567",
      annual_revenue: "$1,250,000.50",
      city: "bombay",
      country: "US",
    };

    const outcome = registry.cleanRow(1, rawRow, {
      batchId: "11111111-1111-4111-8111-111111111111",
      requiredFields: ["first_name", "email"],
      phoneCountry: "+1",
    });

    expect(outcome.status).toBe("cleaned");
    expect(outcome.cleanedPayload.first_name).toBe("John");
    expect(outcome.cleanedPayload.last_name).toBe("O'Brien");
    expect(outcome.cleanedPayload.email).toBe("john.obrien@example.com");
    expect(outcome.cleanedPayload.phone).toBe("+15551234567");
    expect(outcome.cleanedPayload.annual_revenue).toBe("1250000.50");
    expect(outcome.cleanedPayload.city).toBe("Mumbai");
    expect(outcome.cleanedPayload.country).toBe("United States");

    expect(outcome.fieldAudits.length).toBeGreaterThan(0);
    const firstNameAudit = outcome.fieldAudits.find((a) => a.fieldName === "first_name" && a.ruleId === "RL-NAME-01");
    expect(firstNameAudit).toBeDefined();
    expect(firstNameAudit?.newValue).toBe("John");
  });

  it("rejects row when required field is missing (RL-REQ-01)", () => {
    const registry = new CleaningRuleRegistry();

    const rawRow = {
      first_name: "",
      email: "valid@example.com",
    };

    const outcome = registry.cleanRow(2, rawRow, {
      batchId: "11111111-1111-4111-8111-111111111111",
      requiredFields: ["first_name", "email"],
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.rejectReasonCode).toBe("REQUIRED_FIELD_MISSING");
    expect(outcome.rejectReasonText).toBe("Required field 'first_name' is missing or empty");
  });

  it("rejects row with TS-05 message when required email lacks @ sign", () => {
    const registry = new CleaningRuleRegistry();

    const rawRow = {
      first_name: "Alice",
      email: "alice.example.com",
    };

    const outcome = registry.cleanRow(3, rawRow, {
      batchId: "11111111-1111-4111-8111-111111111111",
      requiredFields: ["first_name", "email"],
    });

    expect(outcome.status).toBe("rejected");
    expect(outcome.rejectReasonCode).toBe("INVALID_EMAIL");
    expect(outcome.rejectReasonText).toBe("Email is not valid: value has no @ sign");
  });

  it("redacts sensitive values (passwords, salary, tax IDs) from audit trail (PLT-10)", () => {
    const registry = new CleaningRuleRegistry();

    const rawRow = {
      first_name: "Bob",
      base_salary: "$120,000.00",
      tax_id: "  12-3456789  ",
    };

    const outcome = registry.cleanRow(4, rawRow, {
      batchId: "11111111-1111-4111-8111-111111111111",
      requiredFields: ["first_name"],
    });

    expect(outcome.status).toBe("cleaned");

    const salaryAudit = outcome.fieldAudits.find((a) => a.fieldName === "base_salary");
    expect(salaryAudit).toBeDefined();
    expect(salaryAudit?.isSensitive).toBe(true);
    // Value must be masked (showing only last 4 or redacted)
    expect(salaryAudit?.oldValue).toContain("****");

    const taxAudit = outcome.fieldAudits.find((a) => a.fieldName === "tax_id");
    expect(taxAudit).toBeDefined();
    expect(taxAudit?.isSensitive).toBe(true);
    expect(taxAudit?.oldValue).toContain("****");
  });

  it("skips rules when disabled in configuration", () => {
    const registry = new CleaningRuleRegistry({
      disabledRules: ["RL-NAME-01"],
    });

    const rawRow = {
      first_name: "john smith",
    };

    const outcome = registry.cleanRow(5, rawRow, {
      batchId: "11111111-1111-4111-8111-111111111111",
    });

    expect(outcome.status).toBe("cleaned");
    // Because RL-NAME-01 was disabled, first_name remains lowercase "john smith"
    expect(outcome.cleanedPayload.first_name).toBe("john smith");
    const nameAudit = outcome.fieldAudits.find((a) => a.ruleId === "RL-NAME-01");
    expect(nameAudit).toBeUndefined();
  });
});
