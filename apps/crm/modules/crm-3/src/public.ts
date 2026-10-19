import { ReferenceResolver } from "@cs/kernel";

export interface TicketPublicSummary {
  id: string;
  subject: string;
  status: string;
  priority: string;
  contactId: string;
}

export class Crm3ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "ticket" || entityType === "note";
  }

  async get<T = TicketPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "ticket") {
      return {
        id,
        subject: "Customer Inquiry",
        status: "open",
        priority: "high",
        contactId: "cnt-1234"
      } as unknown as T;
    }
    return null;
  }
}

export const crm3Resolver = new Crm3ReferenceResolver();
