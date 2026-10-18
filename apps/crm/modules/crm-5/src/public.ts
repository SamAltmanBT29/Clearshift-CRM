import { ReferenceResolver } from "@cs/kernel";

export interface ControlScoreSummary {
  batchId: string;
  module: string;
  completeness: string;
  validity: string;
  rejectRate: string;
}

export class Crm5ReferenceResolver implements ReferenceResolver {
  async exists(entityType: string, _id: string): Promise<boolean> {
    return entityType === "run" || entityType === "score";
  }

  async get<T = ControlScoreSummary>(entityType: string, id: string): Promise<T | null> {
    if (entityType === "score") {
      return {
        batchId: id,
        module: "crm1",
        completeness: "98.5",
        validity: "99.1",
        rejectRate: "0.9"
      } as unknown as T;
    }
    return null;
  }
}

export const crm5Resolver = new Crm5ReferenceResolver();
