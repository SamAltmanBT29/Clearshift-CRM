import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRM1ContactCreateSchema,
  CRM1ContactPatchSchema,
  CRM1ContactReadSchema,
  CRM1ConsentStatusSchema,
  CRM1ImportCreateSchema,
  CRM1ImportStatusSchema,
  CRM1EntityTypeSchema,
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

  it("bounds server page size to 100", () => {
    expect(CRM1ListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
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

  it.each([
    [CRM1ConsentStatusSchema, ["unknown", "granted", "withdrawn"], "pending"],
    [CRM1ImportStatusSchema, ["pending", "processing", "completed", "failed"], "cancelled"],
    [CRM1EntityTypeSchema, ["contact", "company", "lead"], "user"]
  ] as const)("rejects unknown enum values", (schema, allowed, invalid) => {
    for (const value of allowed) {
      expect(schema.safeParse(value).success).toBe(true);
    }
    expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("rejects protected source and Golden ID fields in user contact mutations", () => {
    expect(CRM1ContactCreateSchema.safeParse({
      firstName: "Synthetic",
      lastName: "Contact",
      sourceSystem: "fixture",
      sourceId: "id"
    }).success).toBe(false);
    expect(CRM1ContactPatchSchema.safeParse({
      leadStatus: "Qualified",
      goldenId: "browser-controlled"
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

  it("requires the company display name to match the optional company link", () => {
    const contact = {
      id: "00000000-0000-4000-8000-000000000001",
      firstName: "Synthetic",
      lastName: "Contact",
      email: null,
      phone: null,
      address: null,
      companyId: null,
      companyName: null,
      leadStatus: null,
      goldenId: "synthetic-contact-1",
      sourceSystem: null,
      sourceId: null,
      consentStatus: "unknown",
      consentUpdatedAt: null,
      unsubscribed: false,
      unsubscribedUpdatedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    expect(CRM1ContactReadSchema.safeParse(contact).success).toBe(true);
    expect(CRM1ContactReadSchema.safeParse({
      ...contact,
      companyId: "00000000-0000-4000-8000-000000000002"
    }).success).toBe(false);
  });

  it("validates import rows with their entity-specific payload", () => {
    expect(CRM1ImportCreateSchema.safeParse({
      batchId: "00000000-0000-4000-8000-000000000001",
      sourceSystem: "synthetic-fixture",
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: { firstName: "Synthetic", lastName: "Contact", sourceId: "synthetic-1" }
      }]
    }).success).toBe(true);
    expect(CRM1ImportCreateSchema.safeParse({
      batchId: "00000000-0000-4000-8000-000000000001",
      sourceSystem: "synthetic-fixture",
      rows: [{ entity: "lead", sourceRow: 0, data: {} }]
    }).success).toBe(false);
    expect(CRM1ImportCreateSchema.safeParse({
      batchId: "00000000-0000-4000-8000-000000000001",
      sourceSystem: "synthetic-fixture",
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: {
          firstName: "Synthetic",
          lastName: "Contact",
          sourceId: "synthetic-1",
          unsubscribed: false
        }
      }]
    }).success).toBe(false);
  });

  it("requires a caller-supplied batch ID", () => {
    expect(CRM1ImportCreateSchema.safeParse({
      sourceSystem: "synthetic-fixture",
      rows: [{
        entity: "contact",
        sourceRow: 1,
        data: { firstName: "Synthetic", lastName: "Contact", sourceId: "synthetic-1" }
      }]
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

  it.each([
    ["/api/v1/crm-contacts/contacts", "post"],
    ["/api/v1/crm-contacts/contacts/{id}", "patch"],
    ["/api/v1/crm-contacts/companies", "post"],
    ["/api/v1/crm-contacts/companies/{id}", "patch"],
    ["/api/v1/crm-contacts/leads", "post"],
    ["/api/v1/crm-contacts/leads/{id}", "patch"],
    ["/api/v1/crm-contacts/imports", "post"]
  ])("documents validation, authorization, and internal responses for %s %s", (path, method) => {
    const operation = operationBlock(path, method);
    for (const status of ["422", "401", "403", "500"]) {
      expect(operation).toContain(`"${status}":`);
    }
  });

  it.each([
    ["/api/v1/crm-contacts/contacts", "get"],
    ["/api/v1/crm-contacts/contacts", "post"],
    ["/api/v1/crm-contacts/contacts/{id}", "get"],
    ["/api/v1/crm-contacts/contacts/{id}", "patch"],
    ["/api/v1/crm-contacts/companies", "get"],
    ["/api/v1/crm-contacts/companies", "post"],
    ["/api/v1/crm-contacts/companies/{id}", "get"],
    ["/api/v1/crm-contacts/companies/{id}", "patch"],
    ["/api/v1/crm-contacts/leads", "get"],
    ["/api/v1/crm-contacts/leads", "post"],
    ["/api/v1/crm-contacts/leads/{id}", "get"],
    ["/api/v1/crm-contacts/leads/{id}", "patch"],
    ["/api/v1/crm-contacts/imports", "post"],
    ["/api/v1/crm-contacts/imports/{batch}", "get"],
    ["/api/v1/crm-contacts/imports/{batch}/rejects", "get"]
  ])("documents 401 and 403 responses for %s %s", (path, method) => {
    const block = operationBlock(path, method);
    expect(block).toContain('"401":\n          $ref: "#/components/responses/UnauthorizedError"');
    expect(block).toContain('"403":\n          $ref: "#/components/responses/ForbiddenError"');
  });

  it("documents the correlation-aware API error envelope", () => {
    expect(crm1OpenApi).toContain("required: [code, message, details, correlation_id]");
    expect(crm1OpenApi).toContain("correlation_id: { type: string }");
    expect(operationBlock("/api/v1/crm-contacts/leads/{id}", "patch"))
      .toContain("INVALID_LEAD_STATUS_TRANSITION");
  });

  it.each([
    ["/api/v1/crm-contacts/contacts", "get", "ContactList"],
    ["/api/v1/crm-contacts/contacts", "post", "ContactRead"],
    ["/api/v1/crm-contacts/contacts/{id}", "get", "ContactRead"],
    ["/api/v1/crm-contacts/contacts/{id}", "patch", "ContactRead"],
    ["/api/v1/crm-contacts/leads", "get", "LeadList"],
    ["/api/v1/crm-contacts/leads", "post", "LeadRead"],
    ["/api/v1/crm-contacts/leads/{id}", "get", "LeadRead"],
    ["/api/v1/crm-contacts/leads/{id}", "patch", "LeadRead"]
  ])("documents read projections for %s %s", (path, method, schema) => {
    expect(operationBlock(path, method)).toContain(
      `#/components/schemas/${schema}`
    );
  });

  it("documents all 9 CRM-1 domain event schemas in OpenAPI components", () => {
    const eventSchemas = [
      "DomainEventEnvelope",
      "EventContactCreated",
      "EventContactUpdated",
      "EventContactMerged",
      "EventCompanyCreated",
      "EventCompanyUpdated",
      "EventLeadCreated",
      "EventLeadStatusChanged",
      "EventContactConsentChanged",
      "EventImportBatchLoaded",
    ];
    for (const schemaName of eventSchemas) {
      expect(crm1OpenApi).toContain(`${schemaName}:`);
    }
  });

  it("documents the required import idempotency key and replay result", () => {
    const importOperation = operationBlock("/api/v1/crm-contacts/imports", "post");
    expect(crm1OpenApi).toContain("required: [batchId, sourceSystem, rows]");
    expect(importOperation).toContain("name: Idempotency-Key");
    expect(importOperation).toContain("required: true");
    expect(importOperation).toContain("#/components/schemas/ImportBatchDetail");
    expect(importOperation).toContain('"409":');
  });

  describe("CRM1-13 Chunked Batch Load & Partial-Load Stop Schemas", () => {
    it("validates Crm1ExecuteBatchLoadInput with default chunking and threshold values", async () => {
      const {
        Crm1ExecuteBatchLoadInputSchema,
        CRM1_DEFAULT_CHUNK_SIZE,
        CRM1_DEFAULT_FAILURE_THRESHOLD,
        CRM1_DEFAULT_MAX_RETRIES,
      } = await import("../src/crm-1.js");

      const input = {
        batchId: "batch-crm1-01",
        records: [
          {
            sourceRow: 1,
            idempotencyKey: "key-1",
            data: { email: "lead1@example.com" },
          },
        ],
      };

      const parsed = Crm1ExecuteBatchLoadInputSchema.parse(input);
      expect(parsed.chunkSize).toBe(CRM1_DEFAULT_CHUNK_SIZE);
      expect(parsed.chunkSize).toBe(500);
      expect(parsed.failureThreshold).toBe(CRM1_DEFAULT_FAILURE_THRESHOLD);
      expect(parsed.failureThreshold).toBe(0.10);
      expect(parsed.maxRetries).toBe(CRM1_DEFAULT_MAX_RETRIES);
      expect(parsed.maxRetries).toBe(3);
      expect(parsed.module).toBe("crm-1");
      expect(parsed.step).toBe("load");
    });

    it("validates Crm1BatchExecutionStatusSchema allowlist", async () => {
      const { Crm1BatchExecutionStatusSchema } = await import("../src/crm-1.js");
      expect(Crm1BatchExecutionStatusSchema.parse("COMPLETED")).toBe("COMPLETED");
      expect(Crm1BatchExecutionStatusSchema.parse("STOPPED_EXCESSIVE_FAILURES")).toBe(
        "STOPPED_EXCESSIVE_FAILURES"
      );
      expect(Crm1BatchExecutionStatusSchema.parse("FAILED")).toBe("FAILED");
      expect(Crm1BatchExecutionStatusSchema.safeParse("UNKNOWN").success).toBe(false);
    });

    it("documents CRM1-13 batch execution and report paths in OpenAPI", () => {
      expect(crm1OpenApi).toContain("/api/v1/crm-contacts/batches/execute-load:");
      expect(crm1OpenApi).toContain("/api/v1/crm-contacts/batches/{batchId}/report:");
      expect(crm1OpenApi).toContain("BatchExecutionReport:");
      expect(crm1OpenApi).toContain("STOPPED_EXCESSIVE_FAILURES");
    });
  });

  describe("CRM1-05 UX Field Contract & Client Validation (Issue #10)", () => {
    it("exports authoritative labels, helper texts, and validation rules in CRM1_FIELD_CONTRACT", async () => {
      const { CRM1_FIELD_CONTRACT } = await import("../src/crm-1.js");
      expect(CRM1_FIELD_CONTRACT.contact.firstName.label).toBe("First Name");
      expect(CRM1_FIELD_CONTRACT.contact.lastName.label).toBe("Last Name");
      expect(CRM1_FIELD_CONTRACT.contact.email.label).toBe("Email Address");
      expect(CRM1_FIELD_CONTRACT.contact.companyId.label).toBe("Associated Company");
      expect(CRM1_FIELD_CONTRACT.contact.leadStatus.label).toBe("Lead Status");
      expect(CRM1_FIELD_CONTRACT.contact.goldenId.readOnly).toBe(true);

      expect(CRM1_FIELD_CONTRACT.company.name.label).toBe("Company Name");
      expect(CRM1_FIELD_CONTRACT.company.taxNumber.label).toBe("Tax Identification Number");

      expect(CRM1_FIELD_CONTRACT.lead.contactId.label).toBe("Associated Contact");
      expect(CRM1_FIELD_CONTRACT.lead.status.label).toBe("Pipeline Status");
    });
  });
});
