import { describe, it, expect, beforeEach } from "vitest";
import {
  AuditService,
  InMemoryAuditRepository,
  AuditImmutabilityError,
  redactSensitiveData,
  redactErrorMessage,
  createSafeLogEntry,
  maskSensitiveString,
} from "@cs/core";

describe("[PLT-10] Append-Only Audit Trail and Sensitive-Data-Safe Logs", () => {
  let auditRepo: InMemoryAuditRepository;
  let auditService: AuditService;

  beforeEach(() => {
    auditRepo = new InMemoryAuditRepository();
    auditService = new AuditService(auditRepo);
  });

  describe("Privileged Operations Audit Coverage", () => {
    it("creates an audit row for all mandatory privileged operations", async () => {
      // 1. Data Export Generated
      const exportEntry = await auditService.logExport({
        actor: "admin_user",
        correlationId: "corr-exp-1",
        exportType: "CSV",
        entityType: "contacts",
        recordCount: 1500,
        destination: "s3://exports/contacts.csv",
      });
      expect(exportEntry.action).toBe("export.generated");
      expect(exportEntry.targetEntity).toBe("contacts");
      expect(exportEntry.metadata?.["recordCount"]).toBe(1500);

      // 2. Merge Decision (Golden ID)
      const mergeEntry = await auditService.logMergeDecision({
        actor: "pmo_lead",
        correlationId: "corr-mrg-1",
        survivingGoldenId: "gid-contact-100",
        subsumedSourceId: "src-contact-200",
        decision: "approved",
        approverNotes: "Verified duplicate on email match",
      });
      expect(mergeEntry.action).toBe("merge.decided");
      expect(mergeEntry.targetEntity).toBe("golden_id");
      expect(mergeEntry.targetId).toBe("gid-contact-100");

      // 3. Role Changed
      const roleEntry = await auditService.logRoleChange({
        actor: "sys_admin",
        correlationId: "corr-role-1",
        targetUserId: "usr-456",
        oldRoles: ["analyst"],
        newRoles: ["analyst", "export_manager"],
      });
      expect(roleEntry.action).toBe("role.changed");
      expect(roleEntry.targetId).toBe("usr-456");

      // 4. Migration Load Requested
      const loadEntry = await auditService.log({
        actor: "migration_operator",
        action: "load.requested",
        targetEntity: "migration_batch",
        targetId: "batch-2026-10-01",
        correlationId: "corr-load-1",
        batchId: "batch-2026-10-01",
        result: "success",
        metadata: { sourceSystem: "HubSpot", entityType: "deals" },
      });
      expect(loadEntry.action).toBe("load.requested");
      expect(loadEntry.batchId).toBe("batch-2026-10-01");

      // 5. Rollback Requested
      const rollbackEntry = await auditService.log({
        actor: "migration_operator",
        action: "rollback.requested",
        targetEntity: "migration_batch",
        targetId: "batch-2026-10-01",
        correlationId: "corr-rollback-1",
        batchId: "batch-2026-10-01",
        result: "success",
        reason: "Row failure threshold exceeded 10%",
      });
      expect(rollbackEntry.action).toBe("rollback.requested");
      expect(rollbackEntry.reason).toBe("Row failure threshold exceeded 10%");

      // 6. Financial Posting & Reversal
      const postingEntry = await auditService.logFinancialPosting({
        actor: "finance_lead",
        correlationId: "corr-je-1",
        journalEntryId: "je-1001",
        periodId: "period-2026-10",
        totalAmount: "450000.00",
      });
      expect(postingEntry.action).toBe("journal.posted");
      expect(postingEntry.targetId).toBe("je-1001");

      const reversalEntry = await auditService.logFinancialPosting({
        actor: "finance_lead",
        correlationId: "corr-je-rev-1",
        journalEntryId: "je-1002",
        periodId: "period-2026-10",
        totalAmount: "450000.00",
        action: "journal.reversed",
      });
      expect(reversalEntry.action).toBe("journal.reversed");

      // 7. Authentication Failure
      const authFailEntry = await auditService.logAuthFailure({
        username: "unknown_intruder",
        correlationId: "corr-auth-fail-1",
        reason: "INVALID_CREDENTIALS",
        ipAddress: "192.168.1.100",
      });
      expect(authFailEntry.action).toBe("auth.failed");
      expect(authFailEntry.result).toBe("failure");
      expect(authFailEntry.actor).toBe("unknown_intruder");

      // Verify total count
      expect(await auditRepo.count()).toBe(8);
    });

    it("requires actor, action, correlationId, and targetEntity for every audit entry", async () => {
      await expect(
        auditService.log({
          actor: "",
          action: "export.generated",
          targetEntity: "export",
          correlationId: "c-1",
          result: "success",
        })
      ).rejects.toThrow("Audit actor is required");

      await expect(
        auditService.log({
          actor: "admin",
          action: "",
          targetEntity: "export",
          correlationId: "c-1",
          result: "success",
        })
      ).rejects.toThrow("Audit action is required");

      await expect(
        auditService.log({
          actor: "admin",
          action: "export.generated",
          targetEntity: "",
          correlationId: "c-1",
          result: "success",
        })
      ).rejects.toThrow("Audit targetEntity is required");

      await expect(
        auditService.log({
          actor: "admin",
          action: "export.generated",
          targetEntity: "export",
          correlationId: "",
          result: "success",
        })
      ).rejects.toThrow("Audit correlationId is required");
    });
  });

  describe("Append-Only Immutability Invariant", () => {
    it("prohibits updating or deleting existing audit entries", async () => {
      await auditService.logExport({
        actor: "admin",
        correlationId: "corr-immutable",
        exportType: "CSV",
        entityType: "customers",
        recordCount: 10,
      });

      expect(() => auditRepo.update()).toThrow(AuditImmutabilityError);
      expect(() => auditRepo.delete()).toThrow(AuditImmutabilityError);
      expect(await auditRepo.count()).toBe(1);
    });
  });

  describe("Sensitive Data Redaction & Sentinel Secret Leakage Prevention", () => {
    const SENTINEL_AUTH_CREDENTIAL = "SYNTHETIC_TEST_TOKEN_VAL_9988";
    const SENTINEL_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzIiwicm9sZXMiOlsiYWRtaW4iXX0.dGhpcyBpcyBhIHNlY3JldA";
    const SENTINEL_BEARER = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.topsecretpayload";
    const SENTINEL_BANK_ACCOUNT = "98765432109876";
    const SENTINEL_SSN = "000-00-0000";
    const SENTINEL_SALARY = 185000;

    it("redacts sensitive keys and values from deeply nested objects", () => {
      const sensitivePayload = {
        user: {
          username: "john_doe",
          password: SENTINEL_AUTH_CREDENTIAL,
          credentials: {
            argon2Hash: "$argon2id$v=19$m=65536,t=3,p=4$someHashValue",
            token: SENTINEL_JWT,
          },
          employment: {
            title: "Senior Engineer",
            salary: SENTINEL_SALARY,
            base_salary: 175000,
          },
          banking: {
            bank_account: SENTINEL_BANK_ACCOUNT,
            routing_number: "021000021",
            iban: "US12345678901234567890",
          },
          identifiers: {
            ssn: SENTINEL_SSN,
            tax_id: "XX-9988776",
          },
        },
        raw_row: {
          field1: "secret_value",
        },
      };

      const redacted = redactSensitiveData(sensitivePayload);
      const jsonString = JSON.stringify(redacted);

      // Verify ZERO occurrences of any sentinel secret!
      expect(jsonString).not.toContain(SENTINEL_AUTH_CREDENTIAL);
      expect(jsonString).not.toContain(SENTINEL_JWT);
      expect(jsonString).not.toContain(SENTINEL_SSN);
      expect(jsonString).not.toContain(String(SENTINEL_SALARY));
      expect(jsonString).not.toContain("98765432109876");

      // Verify specific redaction masks
      expect(redacted.user.password).toBe("[REDACTED_SECRET]");
      expect(redacted.user.credentials.token).toBe("[REDACTED_SECRET]");
      expect(redacted.user.employment.salary).toBe("[REDACTED_FINANCIAL]");
      expect(redacted.user.banking.bank_account).toBe("****9876");
      expect(redacted.user.identifiers.ssn).toBe("[REDACTED_ID]");
      expect(redacted.raw_row).toBe("[REDACTED]");
    });

    it("redacts credentials and tokens from error messages and exception stack traces", () => {
      const errorWithSecrets = new Error(
        `Failed to connect to upstream with authorization: ${SENTINEL_BEARER} and password=${SENTINEL_AUTH_CREDENTIAL}`
      );

      const safeErrorMsg = redactErrorMessage(errorWithSecrets);
      expect(safeErrorMsg).not.toContain("topsecretpayload");
      expect(safeErrorMsg).not.toContain(SENTINEL_BEARER);
      expect(safeErrorMsg).toContain("Bearer [REDACTED_TOKEN]");
    });

    it("safely generates structured log entries without secret leakage", () => {
      const logEntry = createSafeLogEntry({
        level: "warn",
        correlationId: "corr-log-safe-1",
        actor: "admin_user",
        action: "user.auth.attempt",
        message: `Attempt failed for Bearer ${SENTINEL_JWT}`,
        metadata: {
          submittedPassword: SENTINEL_AUTH_CREDENTIAL,
          accountNumber: SENTINEL_BANK_ACCOUNT,
        },
        error: new Error(`Internal error with secret ${SENTINEL_AUTH_CREDENTIAL}`),
      });

      const logString = JSON.stringify(logEntry);
      expect(logString).not.toContain(SENTINEL_AUTH_CREDENTIAL);
      expect(logString).not.toContain(SENTINEL_JWT);
      expect(logString).toContain("****9876");
      expect(logEntry.level).toBe("warn");
      expect(logEntry.action).toBe("user.auth.attempt");
    });

    it("masks sensitive strings to show only last 4 characters", () => {
      expect(maskSensitiveString("1234567890")).toBe("****7890");
      expect(maskSensitiveString("123")).toBe("[REDACTED]");
    });
  });

  describe("Audit Payload Reference Invariant", () => {
    it("stores references and counts rather than raw domain rows", async () => {
      const auditRecord = await auditService.log({
        actor: "clean_worker",
        action: "batch.cleaned",
        targetEntity: "batch",
        targetId: "batch-101",
        correlationId: "corr-clean-1",
        result: "success",
        metadata: {
          sourceRowCount: 500,
          cleanedRowCount: 480,
          rejectedRowCount: 20,
          sampleErrorLocators: ["row_12", "row_44"],
        },
      });

      expect(auditRecord.targetEntity).toBe("batch");
      expect(auditRecord.targetId).toBe("batch-101");
      expect(auditRecord.metadata?.["sourceRowCount"]).toBe(500);
      expect(auditRecord.metadata?.["rawRow"]).toBeUndefined();
    });
  });
});
