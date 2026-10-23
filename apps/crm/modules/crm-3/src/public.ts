import { ReferenceResolver } from "@cs/kernel";
import { crm3Service, type Crm3Service } from "./services/crm3.service.js";

export interface TicketPublicSummary {
  id: string;
  subject: string;
  status: string;
  priority: string;
  contactId: string;
}

/**
 * Public read facade other modules use to check CRM-3 references.
 * Reads the authoritative ticket and note store, so a lookup always agrees with the API.
 */
export class Crm3ReferenceResolver implements ReferenceResolver {
  constructor(private readonly service: Crm3Service = crm3Service) {}

  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === "ticket") {
      return this.service.ticketExists(id);
    }
    if (entityType === "note") {
      return this.service.noteExists(id);
    }
    return false;
  }

  async get<T = TicketPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "ticket") {
      return this.service.getTicketSummary(id) as T | null;
    }
    return null;
  }
}

export const crm3Resolver = new Crm3ReferenceResolver();
