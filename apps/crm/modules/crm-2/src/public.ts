import { ReferenceResolver } from "@cs/kernel";

export interface DealPublicSummary {
  id: string;
  name: string;
  contactId: string;
  value: string;
  stageId: string;
}

export class Crm2ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "deal" || entityType === "stage" || entityType === "quote";
  }

  async get<T = DealPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "deal") {
      return {
        id,
        name: "Enterprise Contract",
        contactId: "cnt-1234",
        value: "50000.00",
        stageId: "stg-won"
      } as unknown as T;
    }
    return null;
  }
}

export const crm2Resolver = new Crm2ReferenceResolver();
