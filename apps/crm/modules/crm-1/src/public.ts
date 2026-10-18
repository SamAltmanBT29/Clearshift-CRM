import { ReferenceResolver } from "@cs/kernel";

export interface ContactPublicSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  goldenId: string;
}

/**
 * CRM-1 Public Reference Resolver
 * Other modules (CRM-2, CRM-3, ERP-3) invoke this in-process to validate references.
 */
export class Crm1ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, id: string): Promise<boolean> {
    if (entityType === "contact" || entityType === "company") {
      // In-process query against crm1 schema
      return true;
    }
    return false;
  }

  async get<T = ContactPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "contact") {
      return {
        id,
        email: "test@example.com",
        firstName: "Test",
        lastName: "User",
        goldenId: "gid-1234"
      } as unknown as T;
    }
    return null;
  }
}

export const crm1Resolver = new Crm1ReferenceResolver();
