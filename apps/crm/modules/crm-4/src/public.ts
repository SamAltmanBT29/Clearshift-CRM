import { ReferenceResolver } from "@cs/kernel";

export interface CampaignPublicSummary {
  id: string;
  name: string;
  status: string;
}

export class Crm4ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "campaign" || entityType === "list" || entityType === "consent";
  }

  async get<T = CampaignPublicSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "campaign") {
      return {
        id,
        name: "Q4 Product Launch",
        status: "active"
      } as unknown as T;
    }
    return null;
  }
}

export const crm4Resolver = new Crm4ReferenceResolver();
