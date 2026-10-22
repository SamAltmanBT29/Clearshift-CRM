import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertValidTransition,
  isTerminalState,
  isResumableState,
  getAllowedNextStates,
  deriveRunState,
  STATE_TRANSITIONS_MAP,
} from '../../src/domain/transitions.js';
import { IllegalStateTransitionError } from '../../src/domain/errors.js';
import type { MigrationRunStatus } from '@clearshift/contracts';

describe('CRM-5 State Transitions Matrix & Invariants (Issue #51)', () => {
  // ---------------------------------------------------------------------------
  // 1. Allowed Transitions
  // ---------------------------------------------------------------------------
  describe('Allowed Transitions', () => {
    it('allows pending -> running and pending -> failed', () => {
      expect(canTransition('pending', 'running')).toBe(true);
      expect(canTransition('pending', 'failed')).toBe(true);
      expect(() => assertValidTransition('pending', 'running')).not.toThrow();
      expect(() => assertValidTransition('pending', 'failed')).not.toThrow();
    });

    it('allows running -> completed, running -> halted, and running -> failed', () => {
      expect(canTransition('running', 'completed')).toBe(true);
      expect(canTransition('running', 'halted')).toBe(true);
      expect(canTransition('running', 'failed')).toBe(true);
      expect(() => assertValidTransition('running', 'completed')).not.toThrow();
      expect(() => assertValidTransition('running', 'halted')).not.toThrow();
      expect(() => assertValidTransition('running', 'failed')).not.toThrow();
    });

    it('allows halted -> running (resume) and halted -> failed (abort)', () => {
      expect(canTransition('halted', 'running')).toBe(true);
      expect(canTransition('halted', 'failed')).toBe(true);
      expect(() => assertValidTransition('halted', 'running')).not.toThrow();
      expect(() => assertValidTransition('halted', 'failed')).not.toThrow();
    });

    it('allows idempotent same-state transitions', () => {
      const states: MigrationRunStatus[] = ['pending', 'running', 'completed', 'halted', 'failed'];
      for (const s of states) {
        expect(canTransition(s, s)).toBe(true);
        expect(() => assertValidTransition(s, s)).not.toThrow();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Forbidden Transitions (Terminal & Out-of-Order States)
  // ---------------------------------------------------------------------------
  describe('Forbidden Transitions', () => {
    it('forbids completed from transitioning to any other state (terminal)', () => {
      const targetStates: MigrationRunStatus[] = ['pending', 'running', 'halted', 'failed'];
      for (const target of targetStates) {
        expect(canTransition('completed', target)).toBe(false);
        expect(() => assertValidTransition('completed', target)).toThrow(
          IllegalStateTransitionError
        );
      }
    });

    it('forbids failed from transitioning to any other state (terminal)', () => {
      const targetStates: MigrationRunStatus[] = ['pending', 'running', 'completed', 'halted'];
      for (const target of targetStates) {
        expect(canTransition('failed', target)).toBe(false);
        expect(() => assertValidTransition('failed', target)).toThrow(
          IllegalStateTransitionError
        );
      }
    });

    it('forbids jumping directly from pending to completed or halted without running', () => {
      expect(canTransition('pending', 'completed')).toBe(false);
      expect(canTransition('pending', 'halted')).toBe(false);
      expect(() => assertValidTransition('pending', 'completed')).toThrow(
        IllegalStateTransitionError
      );
      expect(() => assertValidTransition('pending', 'halted')).toThrow(
        IllegalStateTransitionError
      );
    });

    it('forbids jumping directly from halted to completed without resuming to running', () => {
      expect(canTransition('halted', 'completed')).toBe(false);
      expect(() => assertValidTransition('halted', 'completed')).toThrow(
        IllegalStateTransitionError
      );
    });

    it('assertValidTransition throws IllegalStateTransitionError with 409 status code', () => {
      try {
        assertValidTransition('completed', 'running');
        expect.fail('Should have thrown IllegalStateTransitionError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(IllegalStateTransitionError);
        const error = err as IllegalStateTransitionError;
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe('CONFLICT');
        expect(error.message).toContain("Cannot revert run from terminal state 'completed'");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. State Helper Utilities
  // ---------------------------------------------------------------------------
  describe('State Utilities & Queries', () => {
    it('correctly identifies terminal states', () => {
      expect(isTerminalState('completed')).toBe(true);
      expect(isTerminalState('failed')).toBe(true);
      expect(isTerminalState('pending')).toBe(false);
      expect(isTerminalState('running')).toBe(false);
      expect(isTerminalState('halted')).toBe(false);
    });

    it('correctly identifies resumable states', () => {
      expect(isResumableState('halted')).toBe(true);
      expect(isResumableState('running')).toBe(false);
      expect(isResumableState('completed')).toBe(false);
      expect(isResumableState('failed')).toBe(false);
      expect(isResumableState('pending')).toBe(false);
    });

    it('returns exact allowed next states from mapping', () => {
      expect(getAllowedNextStates('pending')).toEqual(['running', 'failed']);
      expect(getAllowedNextStates('running')).toEqual(['completed', 'halted', 'failed']);
      expect(getAllowedNextStates('halted')).toEqual(['running', 'failed']);
      expect(getAllowedNextStates('completed')).toEqual([]);
      expect(getAllowedNextStates('failed')).toEqual([]);
    });

    it('derives run state correctly from record telemetry', () => {
      expect(deriveRunState(0, 0, 0)).toBe('pending');
      expect(deriveRunState(100, 50, 0)).toBe('running');
      expect(deriveRunState(100, 90, 10)).toBe('completed');
      expect(deriveRunState(100, 50, 0, true)).toBe('halted');
    });
  });
});
