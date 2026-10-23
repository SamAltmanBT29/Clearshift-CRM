import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertModuleOwnership } from "../src/clients.js";
import { kitCleanLog, kitRejects, stgRows } from "../src/schema/kit.js";

describe("Migration Kit Cleaning Tables Schema & Ownership (KIT-04)", () => {
  const migrationPath = join(__dirname, "../migrations/kit_cleaning_v1.sql");

  describe("kit_cleaning_v1.sql DDL Invariants", () => {
    it("migration file exists in packages/database/migrations", () => {
      expect(existsSync(migrationPath)).toBe(true);
    });

    it("defines public.kit_clean_log table with required columns and indexes", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.kit_clean_log");
      expect(sql).toContain("batch_id UUID NOT NULL REFERENCES public.kit_batches(id)");
      expect(sql).toContain("source_row INTEGER NOT NULL");
      expect(sql).toContain("field_name TEXT NOT NULL");
      expect(sql).toContain("old_value TEXT");
      expect(sql).toContain("new_value TEXT");
      expect(sql).toContain("rule_id TEXT NOT NULL");
      expect(sql).toContain("rule_version TEXT NOT NULL DEFAULT '1.0.0'");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_kit_clean_log_batch_id");
    });

    it("defines public.kit_rejects table with required columns and indexes", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.kit_rejects");
      expect(sql).toContain("batch_id UUID NOT NULL REFERENCES public.kit_batches(id)");
      expect(sql).toContain("source_row INTEGER NOT NULL");
      expect(sql).toContain("entity TEXT NOT NULL");
      expect(sql).toContain("reason_code TEXT NOT NULL");
      expect(sql).toContain("reason_text TEXT NOT NULL");
      expect(sql).toContain("raw_json JSONB NOT NULL DEFAULT '{}'::jsonb");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_kit_rejects_batch_id");
    });

    it("defines public.stg_rows staging table with required columns and unique constraint", () => {
      const sql = readFileSync(migrationPath, "utf8");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.stg_rows");
      expect(sql).toContain("batch_id UUID NOT NULL REFERENCES public.kit_batches(id)");
      expect(sql).toContain("source_row INTEGER NOT NULL");
      expect(sql).toContain("status TEXT NOT NULL DEFAULT 'cleaned'");
      expect(sql).toContain("payload JSONB NOT NULL DEFAULT '{}'::jsonb");
      expect(sql).toContain("CONSTRAINT uq_stg_rows_batch_source_row UNIQUE (batch_id, source_row)");
    });
  });

  describe("PLT-03 Table Ownership Boundary", () => {
    it("allows kit module to write to kit_clean_log, kit_rejects, and stg_rows", () => {
      expect(assertModuleOwnership("kit", "kit_clean_log")).toBe(true);
      expect(assertModuleOwnership("kit", "kit_rejects")).toBe(true);
      expect(assertModuleOwnership("kit", "stg_rows")).toBe(true);
    });

    it("allows platform role administrative access to cleaning tables", () => {
      expect(assertModuleOwnership("platform", "kit_clean_log")).toBe(true);
      expect(assertModuleOwnership("platform", "kit_rejects")).toBe(true);
      expect(assertModuleOwnership("platform", "stg_rows")).toBe(true);
    });

    it("forbids other CRM modules from writing to kit cleaning tables directly", () => {
      expect(() => assertModuleOwnership("crm-1", "kit_clean_log")).toThrow(/\[PLT-03 Ownership Violation\]/);
      expect(() => assertModuleOwnership("crm-1", "kit_rejects")).toThrow(/\[PLT-03 Ownership Violation\]/);
      expect(() => assertModuleOwnership("crm-1", "stg_rows")).toThrow(/\[PLT-03 Ownership Violation\]/);
    });
  });

  describe("Drizzle Table Schema Definition", () => {
    it("exports kitCleanLog, kitRejects, and stgRows tables", () => {
      expect(kitCleanLog).toBeDefined();
      expect(kitRejects).toBeDefined();
      expect(stgRows).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((kitCleanLog as any)[Symbol.for("drizzle:Name")]).toBe("kit_clean_log");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((kitRejects as any)[Symbol.for("drizzle:Name")]).toBe("kit_rejects");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((stgRows as any)[Symbol.for("drizzle:Name")]).toBe("stg_rows");
    });
  });
});
