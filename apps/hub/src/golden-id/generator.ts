import { randomUUID } from 'crypto';
import { EntityType } from '@clearshift/contracts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPLAY_GID_REGEX = /^GID-[A-Z0-9-]+$/i;

const ENTITY_PREFIX_MAP: Record<EntityType, string> = {
  contact: 'CNT',
  company: 'COM',
  customer: 'CUS',
  product: 'PRD',
  vendor: 'VND',
  employee: 'EMP',
};

/**
 * Generates a primary UUID for a Golden Record.
 * Invariant: Primary identities are ALWAYS UUIDs.
 */
export function generatePrimaryIdentityId(): string {
  return randomUUID();
}

/**
 * Formats a display-only GID string from an entity type and UUID.
 * Invariant: Display GID is display-only; NEVER used as a primary or foreign key.
 */
export function formatDisplayGid(entityType: EntityType, uuid: string): string {
  const prefix = ENTITY_PREFIX_MAP[entityType] ?? 'ENT';
  const cleanUuid = uuid.replace(/-/g, '').toUpperCase();
  const shortSegment = cleanUuid.slice(0, 8);
  return `GID-${prefix}-${shortSegment}`;
}

/**
 * Checks if a string is a valid UUID.
 */
export function isUuid(val: string): boolean {
  return UUID_REGEX.test(val);
}

/**
 * Checks if a string is formatted as a display GID (e.g. GID-...).
 */
export function isDisplayGid(val: string): boolean {
  return DISPLAY_GID_REGEX.test(val);
}

/**
 * Non-Negotiable Invariant Validator (Acceptance Criterion 5):
 * Asserts that a display GID is NEVER passed as a primary key or foreign key.
 * Throws a descriptive Error if a display GID is used where a primary/foreign key is required.
 */
export function assertNotDisplayGidAsKey(
  id: string,
  fieldName: string = 'id'
): void {
  if (isDisplayGid(id)) {
    throw new Error(
      `[PLT-07 Invariant Violation] Display GID '${id}' cannot be used as a primary or foreign key for '${fieldName}'. Hub primary identities must be valid UUIDs.`
    );
  }
  if (!isUuid(id)) {
    throw new Error(
      `[PLT-07 Invariant Violation] Value '${id}' for '${fieldName}' is not a valid UUID.`
    );
  }
}
