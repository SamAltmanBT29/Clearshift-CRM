import {
  CRM1_LEAD_STATUS_TRANSITIONS,
  CRM1LeadStatusSchema,
  type CRM1LeadStatus
} from "@clearshift/contracts/crm-1";
import { AppError } from "@cs/kernel";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  crm1Companies,
  crm1Contacts
} from "../../db/schema.js";

type Transaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export { CRM1_LEAD_STATUS_TRANSITIONS };

export function isLeadStatusTransitionAllowed(
  current: CRM1LeadStatus,
  next: CRM1LeadStatus
): boolean {
  if (current === next) {
    return true;
  }
  const allowedTransitions = CRM1_LEAD_STATUS_TRANSITIONS[current];
  return allowedTransitions?.includes(next) === true;
}

export function assertLeadStatusTransition(
  current: CRM1LeadStatus,
  next: CRM1LeadStatus,
  field = "status"
): void {
  if (!isLeadStatusTransitionAllowed(current, next)) {
    throw new AppError(
      "INVALID_LEAD_STATUS_TRANSITION",
      `Lead status cannot transition from ${current} to ${next}`,
      422,
      [{ field, message: "Move the lead to the next lifecycle status", code: "invalid_transition" }]
    );
  }
}

export async function assertCompanyExists(
  tx: Transaction,
  companyId: string | null | undefined
): Promise<void> {
  if (companyId == null) {
    return;
  }
  const [company] = await tx.select({ id: crm1Companies.id }).from(crm1Companies)
    .where(eq(crm1Companies.id, companyId)).limit(1);
  if (!company) {
    throw new AppError("REFERENCE_NOT_FOUND", "The selected company does not exist", 422, [
      { field: "companyId", message: "Choose an existing company", code: "invalid_reference" }
    ]);
  }
}

export async function assertContactExists(
  tx: Transaction,
  contactId: string | null | undefined
): Promise<void> {
  if (contactId == null) {
    return;
  }
  const [contact] = await tx.select({ id: crm1Contacts.id }).from(crm1Contacts)
    .where(eq(crm1Contacts.id, contactId)).limit(1);
  if (!contact) {
    throw new AppError("REFERENCE_NOT_FOUND", "The selected contact does not exist", 422, [
      { field: "contactId", message: "Choose an existing contact", code: "invalid_reference" }
    ]);
  }
}

export function parseStoredLeadStatus(value: string): CRM1LeadStatus {
  const result = CRM1LeadStatusSchema.safeParse(value);
  if (!result.success) {
    throw new AppError("INVALID_DOMAIN_VALUE", "A stored CRM-1 lead status is invalid", 500, [
      { field: "status", message: "Stored status violates the CRM-1 contract", code: "invalid_value" }
    ]);
  }
  return result.data;
}
