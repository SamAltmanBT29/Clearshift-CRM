import { ReferenceResolver } from "@cs/kernel";
import { getDatabase } from "@cs/db";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { crm1Companies, crm1Contacts } from "../db/schema.js";
import type { Crm1Service } from "./services/crm1.service.js";

export interface ContactPublicSummary {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  goldenId: string;
}

export interface CompanyPublicSummary {
  id: string;
  name: string;
  taxNumber: string | null;
  email: string | null;
}

export class Crm1ReferenceResolver implements ReferenceResolver {
  private readonly db?: NodePgDatabase;

  constructor(db?: NodePgDatabase, private readonly service?: Crm1Service) {
    if (db) {
      this.db = db;
    } else if (!service) {
      try {
        this.db = getDatabase();
      } catch {
        // DB not available in test
      }
    }
  }

  async exists(entityType: string, id: string): Promise<boolean> {
    if (this.service) {
      if (entityType === "contact") {
        const contact = await this.service.getContactById(id);
        return contact !== null;
      }
      if (entityType === "company") {
        const company = await this.service.getCompanyById(id);
        return company !== null;
      }
      return false;
    }

    if (this.db) {
      if (entityType === "contact") {
        const [contact] = await this.db.select({ id: crm1Contacts.id })
          .from(crm1Contacts).where(eq(crm1Contacts.id, id)).limit(1);
        return contact !== undefined;
      }
      if (entityType === "company") {
        const [company] = await this.db.select({ id: crm1Companies.id })
          .from(crm1Companies).where(eq(crm1Companies.id, id)).limit(1);
        return company !== undefined;
      }
    }
    return false;
  }

  async get<T = ContactPublicSummary | CompanyPublicSummary>(
    entityType: string,
    id: string
  ): Promise<T | null> {
    if (this.service) {
      if (entityType === "contact") {
        const contact = await this.service.getContactById(id);
        if (!contact) return null;
        return {
          id: contact.id,
          email: contact.email,
          firstName: contact.firstName,
          lastName: contact.lastName,
          goldenId: contact.goldenId,
        } as T;
      }
      if (entityType === "company") {
        const company = await this.service.getCompanyById(id);
        if (!company) return null;
        return {
          id: company.id,
          name: company.name,
          taxNumber: company.taxNumber,
          email: company.email ?? null,
        } as T;
      }
      return null;
    }

    if (this.db) {
      if (entityType === "contact") {
        const [contact] = await this.db.select({
          id: crm1Contacts.id,
          email: crm1Contacts.email,
          firstName: crm1Contacts.firstName,
          lastName: crm1Contacts.lastName,
          goldenId: crm1Contacts.goldenId
        }).from(crm1Contacts).where(eq(crm1Contacts.id, id)).limit(1);
        return contact ? contact as T : null;
      }
      if (entityType === "company") {
        const [company] = await this.db.select({
          id: crm1Companies.id,
          name: crm1Companies.name,
          taxNumber: crm1Companies.taxNumber,
          email: crm1Companies.email
        }).from(crm1Companies).where(eq(crm1Companies.id, id)).limit(1);
        return company ? company as T : null;
      }
    }
    return null;
  }
}

export const crm1Resolver = new Crm1ReferenceResolver();
