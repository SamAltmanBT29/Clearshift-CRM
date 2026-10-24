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
  CRM2_TARGET_ENTITIES,
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

    // CRM-2 target entities
    expect(CRM_TARGET_ENTITIES.crm2_deals).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm2_deals.module).toBe('crm-2');
    expect(CRM_TARGET_ENTITIES.crm2_deals.fields.some((f) => f.name === 'name' && f.required)).toBe(true);
    expect(CRM_TARGET_ENTITIES.crm2_deals.fields.some((f) => f.name === 'value' && f.dataType === 'number')).toBe(true);
    expect(CRM_TARGET_ENTITIES.crm2_deals.fields.some((f) => f.name === 'stage_name' && f.dataType === 'enum')).toBe(true);

    expect(CRM_TARGET_ENTITIES.crm2_quotes).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm2_quotes.module).toBe('crm-2');
    expect(CRM_TARGET_ENTITIES.crm2_quotes.fields.some((f) => f.name === 'quote_number' && f.required)).toBe(true);
    expect(CRM_TARGET_ENTITIES.crm2_quotes.fields.some((f) => f.name === 'amount' && f.dataType === 'number')).toBe(true);

    expect(CRM_TARGET_ENTITIES.crm2_stages).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm2_stages.module).toBe('crm-2');
    expect(CRM_TARGET_ENTITIES.crm2_quote_lines).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm2_quote_lines.module).toBe('crm-2');

    // CRM-5 target entities
    expect(CRM_TARGET_ENTITIES.crm5_runs).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm5_runs.module).toBe('crm-5');
    expect(CRM_TARGET_ENTITIES.crm5_runs.fields.some((f) => f.name === 'batchId' && f.required)).toBe(true);
    expect(CRM_TARGET_ENTITIES.crm5_runs.fields.some((f) => f.name === 'step' && f.dataType === 'enum')).toBe(true);

    expect(CRM_TARGET_ENTITIES.crm5_scores).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm5_scores.module).toBe('crm-5');
    expect(CRM_TARGET_ENTITIES.crm5_scores.fields.some((f) => f.name === 'score' && f.required && f.dataType === 'number')).toBe(true);

    expect(CRM_TARGET_ENTITIES.crm5_rejects).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm5_rejects.module).toBe('crm-5');
    expect(CRM_TARGET_ENTITIES.crm5_rejects.fields.some((f) => f.name === 'errorCode' && f.required)).toBe(true);

    expect(CRM_TARGET_ENTITIES.crm5_reconciliation_reports).toBeDefined();
    expect(CRM_TARGET_ENTITIES.crm5_reconciliation_reports.module).toBe('crm-5');
    expect(CRM_TARGET_ENTITIES.crm5_reconciliation_reports.fields.some((f) => f.name === 'status' && f.dataType === 'enum')).toBe(true);
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
