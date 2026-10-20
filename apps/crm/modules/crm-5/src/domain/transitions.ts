import type { MigrationRunStatus } from '@clearshift/contracts';
import { IllegalStateTransitionError } from './errors.js';

/**
 * Migration Run State Transition Matrix
 * Enforces strict lifecycle state machines for migration run projections.
 * Terminal states ('completed', 'failed') cannot transition to any other state.
 */
export const STATE_TRANSITIONS_MAP: Record<MigrationRunStatus, readonly MigrationRunStatus[]> = {
  pending: ['running', 'failed'],
  running: ['completed', 'halted', 'failed'],
  halted: ['running', 'failed'], // Can be resumed back to running or aborted to failed
  completed: [], // Terminal
  failed: [], // Terminal
} as const;

/**
 * Checks whether a transition between two run states is permitted.
 * If fromState === toState, it is considered an idempotent state refresh (true).
 */
export function canTransition(fromState: MigrationRunStatus, toState: MigrationRunStatus): boolean {
  if (fromState === toState) {
    return true; // Idempotent same-state update
  }
  const allowed = STATE_TRANSITIONS_MAP[fromState];
  return allowed ? allowed.includes(toState) : false;
}

/**
 * Asserts that a state transition is valid, throwing an IllegalStateTransitionError (409) if forbidden.
 */
export function assertValidTransition(
  fromState: MigrationRunStatus,
  toState: MigrationRunStatus
): void {
  if (!canTransition(fromState, toState)) {
    throw new IllegalStateTransitionError(fromState, toState, {
      fromState,
      toState,
      allowedTransitions: STATE_TRANSITIONS_MAP[fromState],
    });
  }
}

/**
 * Returns true if the status is a terminal state (cannot transition further).
 */
export function isTerminalState(status: MigrationRunStatus): boolean {
  return STATE_TRANSITIONS_MAP[status].length === 0;
}

/**
 * Returns true if the status is a halted state that can be resumed.
 */
export function isResumableState(status: MigrationRunStatus): boolean {
  return status === 'halted';
}

/**
 * Gets the list of valid next states from the current state.
 */
export function getAllowedNextStates(status: MigrationRunStatus): readonly MigrationRunStatus[] {
  return STATE_TRANSITIONS_MAP[status] ?? [];
}

/**
 * Derives a run state based on execution telemetry and halt thresholds.
 */
export function deriveRunState(
  recordsIn: number,
  recordsOut: number,
  recordsRejected: number,
  isHalted = false
): MigrationRunStatus {
  if (isHalted) {
    return 'halted';
  }
  if (recordsIn === 0 && recordsOut === 0 && recordsRejected === 0) {
    return 'pending';
  }
  if (recordsOut + recordsRejected >= recordsIn && recordsIn > 0) {
    return 'completed';
  }
  return 'running';
}
