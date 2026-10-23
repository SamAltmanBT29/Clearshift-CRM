import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  calculateReconciliation,
  computeIdempotencyKey,
  evaluateStopCondition,
  assertV1RecoveryBoundaries,
  validateRunbookDocument,
  validateIncidentRolesDocument,
  validateDemoScheduleDocument,
  IncidentSeverity,
  INCIDENT_SLAS,
} from '../src/governance/recovery.js';

describe('PMO-12: V1 Recovery Runbook, Demo Rehearsal and Incident Roles', () => {
  const rootDir = path.resolve(__dirname, '../../..');

  // ---------------------------------------------------------------------------
  // 1. Reconciliation Invariant Tests
  // ---------------------------------------------------------------------------
  describe('Reconciliation Invariant Formula', () => {
    it('verifies exact balance when source equals sum of all terminal states (unaccounted = 0)', () => {
      const result = calculateReconciliation({
        source: 50000,
        loaded: 46500,
        rejected: 3000,
        merged: 400,
        skipped: 100,
      });

      expect(result.isValid).toBe(true);
      expect(result.accounted).toBe(50000);
      expect(result.unaccounted).toBe(0);
      expect(result.discrepancyMessage).toBeUndefined();
    });

    it('detects unaccounted row discrepancy when rows are missing', () => {
      const result = calculateReconciliation({
        source: 50000,
        loaded: 46000,
        rejected: 3000,
        merged: 400,
        skipped: 100, // Sum = 49500 (500 unaccounted)
      });

      expect(result.isValid).toBe(false);
      expect(result.accounted).toBe(49500);
      expect(result.unaccounted).toBe(500);
      expect(result.discrepancyMessage).toContain('source (50000) != accounted (49500)');
    });

    it('detects negative discrepancy when accounted rows exceed source', () => {
      const result = calculateReconciliation({
        source: 100,
        loaded: 80,
        rejected: 20,
        merged: 5,
        skipped: 0, // Sum = 105 (-5 unaccounted)
      });

      expect(result.isValid).toBe(false);
      expect(result.unaccounted).toBe(-5);
    });

    it('throws error when negative counts are supplied', () => {
      expect(() =>
        calculateReconciliation({
          source: 100,
          loaded: -1,
          rejected: 10,
          merged: 0,
          skipped: 0,
        })
      ).toThrow('Reconciliation counts must be non-negative integers');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Deterministic Idempotency Key Tests
  // ---------------------------------------------------------------------------
  describe('Deterministic Idempotency Key Generation', () => {
    it('generates consistent SHA-256 hash for identical input arguments', () => {
      const batchId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      const key1 = computeIdempotencyKey(batchId, 42, 'crm_contacts', 'v1');
      const key2 = computeIdempotencyKey(batchId, 42, 'crm_contacts', 'v1');

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces distinct hashes when row number or batch ID differs', () => {
      const batchId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
      const keyRow42 = computeIdempotencyKey(batchId, 42, 'crm_contacts', 'v1');
      const keyRow43 = computeIdempotencyKey(batchId, 43, 'crm_contacts', 'v1');
      const keyDiffBatch = computeIdempotencyKey(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        42,
        'crm_contacts',
        'v1'
      );

      expect(keyRow42).not.toBe(keyRow43);
      expect(keyRow42).not.toBe(keyDiffBatch);
    });

    it('rejects invalid arguments for key generation', () => {
      expect(() => computeIdempotencyKey('', 1, 'crm_contacts', 'v1')).toThrow();
      expect(() => computeIdempotencyKey('b-1', 0, 'crm_contacts', 'v1')).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Stop Condition & Threshold Tests
  // ---------------------------------------------------------------------------
  describe('Stop Condition Triggers', () => {
    it('triggers stop when cumulative row failure rate exceeds 10%', () => {
      const evaluation = evaluateStopCondition({
        attemptedRows: 1000,
        failedRows: 101, // 10.1%
      });

      expect(evaluation.shouldHalt).toBe(true);
      expect(evaluation.reason).toContain('exceeds 10% threshold (STP-01)');
    });

    it('allows ingestion to continue when failure rate is exactly 10% or below', () => {
      const evalAt10 = evaluateStopCondition({
        attemptedRows: 1000,
        failedRows: 100, // 10.0%
      });
      const evalAt5 = evaluateStopCondition({
        attemptedRows: 1000,
        failedRows: 50, // 5.0%
      });

      expect(evalAt10.shouldHalt).toBe(false);
      expect(evalAt5.shouldHalt).toBe(false);
    });

    it('triggers stop when source file size exceeds 50 MB ceiling', () => {
      const evaluation = evaluateStopCondition({
        attemptedRows: 100,
        failedRows: 0,
        fileSizeBytes: 52 * 1024 * 1024, // 52 MB
      });

      expect(evaluation.shouldHalt).toBe(true);
      expect(evaluation.reason).toContain('exceeds 50 MB maximum ceiling (STP-02)');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. V1 Non-Negotiable Boundary Assertions
  // ---------------------------------------------------------------------------
  describe('V1 Architectural Boundaries Enforcement', () => {
    it('prohibits compensating rollback sagas in V1', () => {
      expect(() =>
        assertV1RecoveryBoundaries({
          hasRollbackSaga: true,
          stopsOnFailure: true,
          deterministicIdempotency: true,
        })
      ).toThrow('Compensating rollback saga is strictly out of scope for V1');
    });

    it('prohibits fuzzy auto-merge in V1', () => {
      expect(() =>
        assertV1RecoveryBoundaries({
          hasFuzzyAutoMerge: true,
          stopsOnFailure: true,
          deterministicIdempotency: true,
        })
      ).toThrow('Fuzzy duplicate auto-merge is strictly out of scope for V1');
    });

    it('requires stop on failure and deterministic idempotency to be enabled', () => {
      expect(() =>
        assertV1RecoveryBoundaries({
          stopsOnFailure: false,
          deterministicIdempotency: true,
        })
      ).toThrow('Automatic stop-on-failure safety must be enabled');

      expect(() =>
        assertV1RecoveryBoundaries({
          stopsOnFailure: true,
          deterministicIdempotency: false,
        })
      ).toThrow('Deterministic idempotency key verification must be enabled');
    });

    it('passes for compliant V1 recovery policy', () => {
      expect(() =>
        assertV1RecoveryBoundaries({
          hasRollbackSaga: false,
          hasFuzzyAutoMerge: false,
          stopsOnFailure: true,
          deterministicIdempotency: true,
        })
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Incident SLAs and Hierarchy Validation
  // ---------------------------------------------------------------------------
  describe('Incident Response SLAs', () => {
    it('enforces 15-minute response and 30-minute status broadcast for SEV-1', () => {
      const sla = INCIDENT_SLAS[IncidentSeverity.SEV_1_CRITICAL];
      expect(sla.responseMinutes).toBe(15);
      expect(sla.updateCadenceMinutes).toBe(30);
    });

    it('enforces 30-minute response and 60-minute status broadcast for SEV-2', () => {
      const sla = INCIDENT_SLAS[IncidentSeverity.SEV_2_HIGH];
      expect(sla.responseMinutes).toBe(30);
      expect(sla.updateCadenceMinutes).toBe(60);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Documentation Artifact Integrity Checks
  // ---------------------------------------------------------------------------
  describe('Documentation Governance Verification', () => {
    it('verifies v1-operational-recovery-runbook.md exists and contains all required sections', () => {
      const filePath = path.join(rootDir, 'docs/runbooks/v1-operational-recovery-runbook.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const validation = validateRunbookDocument(content);

      expect(validation.isValid).toBe(true);
      expect(validation.missingSections).toHaveLength(0);
      expect(content).toContain('STP-01');
      expect(content).toContain('10%');
      expect(content).toContain('50 MB');
    });

    it('verifies incident-response-roles.md exists and defines roles and escalation tiers', () => {
      const filePath = path.join(rootDir, 'docs/governance/incident-response-roles.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const validation = validateIncidentRolesDocument(content);

      expect(validation.isValid).toBe(true);
      expect(validation.missingSections).toHaveLength(0);
      expect(content).toContain('Incident Commander');
      expect(content).toContain('Communications Lead');
      expect(content).toContain('SEV-1 (Critical)');
    });

    it('verifies gate-g4-demo-rehearsal-schedule.md exists and defines 45-minute showcase', () => {
      const filePath = path.join(rootDir, 'docs/governance/gate-g4-demo-rehearsal-schedule.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      const validation = validateDemoScheduleDocument(content);

      expect(validation.isValid).toBe(true);
      expect(validation.missingSections).toHaveLength(0);
      expect(content).toContain('Rehearsal 1');
      expect(content).toContain('Rehearsal 2');
      expect(content).toContain('Rehearsal 3');
      expect(content).toContain('45 Minutes Total');
    });

    it('verifies ADR-004 exists and documents recovery and incident architectural decisions', () => {
      const filePath = path.join(rootDir, 'docs/adr/ADR-004-v1-recovery-boundary-and-incident-model.md');
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).toContain('ADR-004');
      expect(content).toContain('Stop-on-Failure Operational Model');
      expect(content).toContain('Deterministic Idempotency Key');
    });
  });
});
