import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRM1ContactCreateSchema,
  CRM1ContactPatchSchema,
  CRM1ImportCreateSchema,
  CRM1LeadStatusSchema,
  CRM1ListQuerySchema
} from "../src/crm-1.js";

const crm1OpenApi = readFileSync(new URL("../openapi/crm-1.yaml", import.meta.url), "utf8");

function operationBlock(path: string, method: string): string {
  const pathMarker = `  ${path}:\n`;
  const pathStart = crm1OpenApi.indexOf(pathMarker);
  if (pathStart < 0) {
    return "";
  }

  const nextPathStart = crm1OpenApi.indexOf("\n  /api/v1/crm-contacts/", pathStart + pathMarker.length);
  const pathBlock = crm1OpenApi.slice(
    pathStart,
    nextPathStart < 0 ? undefined : nextPathStart
  );
  const methodMarker = `    ${method}:\n`;
  const methodStart = pathBlock.indexOf(methodMarker);
  if (methodStart < 0) {
    return "";
  }

  const nextMethodMatch = /\n    (?:get|post|patch|put|delete):\n/.exec(
    pathBlock.slice(methodStart + methodMarker.length)
  );
  return pathBlock.slice(
    methodStart,
    nextMethodMatch
      ? methodStart + methodMarker.length + nextMethodMatch.index
      : undefined
  );
}

describe("CRM-1 public contracts", () => {
  it("defaults contact list requests to page 1 and page size 25", () => {
    expect(CRM1ListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });

  it("accepts name/email search and numeric query-string pagination", () => {
    expect(CRM1ListQuerySchema.parse({ search: "Alex", page: "2", pageSize: "15" })).toEqual({
      search: "Alex",
      page: 2,
      pageSize: 15
    });
  });

  it.each(["New", "Working", "Qualified", "Closed"])("accepts lead status %s", (status) => {
    expect(CRM1LeadStatusSchema.parse(status)).toBe(status);
  });

  it("rejects unsupported lead statuses", () => {
    expect(CRM1LeadStatusSchema.safeParse("Prospect").success).toBe(false);
  });

  it("requires source system and source id to be supplied as a pair", () => {
    expect(CRM1ContactCreateSchema.safeParse({
      firstName: "Synthetic",
      lastName: "Contact",
      sourceSystem: "fixture"
    }).success).toBe(false);
  });

  it("rejects empty patches and invalid contact email addresses", () => {
    expect(CRM1ContactPatchSchema.safeParse({}).success).toBe(false);
    expect(CRM1ContactCreateSchema.safeParse({
      firstName: "Synthetic",
      lastName: "Contact",
      email: "not-an-email"
    }).success).toBe(false);
  });

  it("validates import rows with their entity-specific payload", () => {
    expect(CRM1ImportCreateSchema.safeParse({
      sourceSystem: "synthetic-fixture",
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: { firstName: "Synthetic", lastName: "Contact", sourceId: "synthetic-1" }
      }]
    }).success).toBe(true);
    expect(CRM1ImportCreateSchema.safeParse({
      sourceSystem: "synthetic-fixture",
      rows: [{ entity: "lead", sourceRow: 0, data: {} }]
    }).success).toBe(false);
  });

  it.each([
    ["/api/v1/crm-contacts/contacts", "post"],
    ["/api/v1/crm-contacts/contacts/{id}", "patch"],
    ["/api/v1/crm-contacts/companies", "post"],
    ["/api/v1/crm-contacts/companies/{id}", "patch"],
    ["/api/v1/crm-contacts/leads", "post"],
    ["/api/v1/crm-contacts/leads/{id}", "patch"]
  ])("documents conflict responses for %s %s", (path, method) => {
    expect(operationBlock(path, method)).toContain(
      '"409":\n          $ref: "#/components/responses/ConflictError"'
    );
  });

  it("documents the correlation-aware API error envelope", () => {
    expect(crm1OpenApi).toContain("required: [code, message, details, correlation_id]");
    expect(crm1OpenApi).toContain("correlation_id: { type: string }");
  });
});
