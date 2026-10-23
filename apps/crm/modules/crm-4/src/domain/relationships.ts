import { AppError, type ReferenceResolver } from '@cs/kernel';
import {
  type CRM4MemberStatus,
  type CRM4ConsentStatus,
  assertValidMemberStatus,
  assertValidConsentStatus,
  assertMonotonicOptOut,
} from '@clearshift/contracts';

/**
 * Valid allowed lifecycle forward transitions for campaign membership:
 * sent -> opened
 * opened -> clicked
 * sent -> clicked (direct transition if tracking skip occurs)
 * Reversals (e.g. clicked -> sent, opened -> sent) or arbitrary transitions are strictly forbidden.
 */
export const ALLOWED_MEMBER_TRANSITIONS: Record<CRM4MemberStatus, readonly CRM4MemberStatus[]> = {
  sent: ['opened', 'clicked'],
  opened: ['clicked'],
  clicked: [], // Terminal engagement state
};

/**
 * Validates a member lifecycle status transition.
 * Returns true if transition is identical (no-op) or allowed.
 * Throws AppError 422 if transition violates workflow state machine.
 */
export function assertValidMemberStatusTransition(
  fromStatus: CRM4MemberStatus,
  toStatus: string
): void {
  try {
    assertValidMemberStatus(toStatus);
  } catch (err: any) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Invalid member status '${toStatus}'. Permitted statuses are: sent, opened, clicked`,
      422,
      [{ field: 'status', message: err.message }]
    );
  }

  if (fromStatus === toStatus) {
    return;
  }

  const allowed = ALLOWED_MEMBER_TRANSITIONS[fromStatus];
  if (!allowed.includes(toStatus)) {
    throw new AppError(
      'INVALID_STATE_TRANSITION',
      `Illegal member status transition from '${fromStatus}' to '${toStatus}'. Allowed transitions: [${allowed.join(', ')}]`,
      422,
      [{ field: 'status', message: `Cannot transition status from '${fromStatus}' to '${toStatus}'` }]
    );
  }
}

/**
 * Enforces BR-CRM4-01 monotonic consent state transition.
 * Allows subscribed -> unsubscribed.
 * Forbids unsubscribed -> subscribed (returns 409 Conflict).
 */
export function assertValidConsentStatusTransition(
  fromStatus: CRM4ConsentStatus | null | undefined,
  toStatus: string
): void {
  assertValidConsentStatus(toStatus);
  try {
    assertMonotonicOptOut(fromStatus, toStatus);
  } catch (err: any) {
    throw new AppError(
      'CONFLICT',
      err.message || 'Domain Invariant Violation (BR-CRM4-01): Known opt-out cannot be changed to subscribed.',
      409,
      [{ field: 'status', message: 'Monotonic opt-out invariant: cannot revert unsubscribed to subscribed' }]
    );
  }
}

/**
 * Cross-module referential integrity validator.
 * Validates contact reference against CRM-1 Contact master entity via ReferenceResolver port.
 * Throws AppError 404 if contact does not exist in CRM-1.
 */
export async function assertContactExists(
  resolver: ReferenceResolver | undefined,
  contactId: string
): Promise<void> {
  if (!resolver) {
    return;
  }

  const exists = await resolver.exists('contact', contactId);
  if (!exists) {
    throw new AppError(
      'NOT_FOUND',
      `Referenced CRM-1 contact '${contactId}' does not exist`,
      404,
      [{ field: 'contactId', message: `Contact '${contactId}' not found in CRM-1` }]
    );
  }
}
