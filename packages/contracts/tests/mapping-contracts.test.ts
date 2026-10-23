import { describe, it, expect } from 'vitest';
import {
  FieldMappingDefinitionSchema,
  ValueConversionRuleSchema,
  MappingTemplateSchema,
  CreateMappingTemplateInputSchema,
  TargetFieldDefinitionSchema,
  MappingValidationResultSchema,
  BatchMappedPayloadSchema,
  CRM_TARGET_ENTITIES,
} from '../src/migration-target.js';

describe('KIT-05: Mapping Contracts & Zod Schemas', () => {
  it('validates FieldMappingDefinitionSchema with defaults', () => {
    const valid = FieldMappingDefinitionSchema.parse({
      sourceColumn: 'first_name',
      targetField: 'firstName',
    });
    expect(valid.sourceColumn).toBe('first_name');
    expect(valid.targetField).toBe('firstName');
    expect(valid.required).toBe(false);
    expect(valid.transformation).toBe('identity');
  });

  it('validates ValueConversionRuleSchema with unmapped actions', () => {
    const valid = ValueConversionRuleSchema.parse({
      targetField: 'leadStatus',
      mappings: {
        NEW: 'New',
        IN_PROGRESS: 'Working',
        QUALIFIED: 'Qualified',
        DISQUALIFIED: 'Closed',
      },
      unmappedAction: 'reject',
    });
    expect(valid.targetField).toBe('leadStatus');
    expect(valid.mappings.NEW).toBe('New');
    expect(valid.unmappedAction).toBe('reject');
  });

  it('validates complete MappingTemplateSchema', () => {
    const template = {
      id: 'a0000000-0000-4000-8000-000000000001',
      module: 'crm-1',
      name: 'CRM 1 Contacts Default Mapping',
      version: '1.0.0',
      targetEntity: 'contacts',
      fieldMappings: [
        { sourceColumn: 'first_name', targetField: 'firstName', required: true },
        { sourceColumn: 'last_name', targetField: 'lastName', required: true },
        { sourceColumn: 'email', targetField: 'email', required: true },
        { sourceColumn: 'phone', targetField: 'phone' },
      ],
      valueConversions: [],
      createdBy: 'migration_admin',
    };

    const parsed = MappingTemplateSchema.parse(template);
    expect(parsed.module).toBe('crm-1');
    expect(parsed.fieldMappings.length).toBe(4);
  });

  it('validates CRM_TARGET_ENTITIES definitions', () => {
    expect(CRM_TARGET_ENTITIES.contacts).toBeDefined();
    expect(CRM_TARGET_ENTITIES.contacts.fields.some((f) => f.name === 'email' && f.required)).toBe(true);
    expect(CRM_TARGET_ENTITIES.leads).toBeDefined();
    expect(CRM_TARGET_ENTITIES.leads.fields.some((f) => f.name === 'leadStatus' && f.required)).toBe(true);
  });

  it('validates BatchMappedPayloadSchema outbox event contract', () => {
    const payload = {
      batchId: 'b0000000-0000-4000-8000-000000000001',
      module: 'crm',
      mappedRows: 925,
      missingRequired: 0,
      targetEntity: 'contacts',
      templateId: 't0000000-0000-4000-8000-000000000001',
      templateName: 'Default CRM Mapping',
      totalRows: 1000,
      durationMs: 120,
    };

    const parsed = BatchMappedPayloadSchema.parse(payload);
    expect(parsed.mappedRows).toBe(925);
    expect(parsed.missingRequired).toBe(0);
  });
});
