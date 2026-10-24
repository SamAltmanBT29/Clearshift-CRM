import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import {
  CRM_TARGET_ENTITIES,
  CRM2_TARGET_ENTITIES,
  CRM2_DEALS_TARGET_FIELDS,
  CRM2_QUOTES_TARGET_FIELDS,
  CRM2_STAGES_TARGET_FIELDS,
  CRM2_QUOTE_LINES_TARGET_FIELDS,
} from '@clearshift/contracts';
import {
  getCrm2TargetEntityDefinitions,
  getCrm2TargetEntity,
  checkFieldTypeCompatibility,
  evaluateMappingCompatibility,
  validateCrm2WizardMapping,
  assertDryRunEligible,
} from '../../src/kit/wizard-metadata.js';
import { WizardMappingPage } from '../../web/pages/WizardMappingPage.js';
import { MappingScreen } from '../../../../../migration-kit/web/src/pages/MappingScreen.js';

describe('CRM-2 Deals, Pipeline and Quotes: Migration Kit Wizard Metadata Integration (Issue #135 / [CRM2-22])', () => {
  beforeAll(() => {
    // Mock lightweight React dispatcher for pure Node.js rendering tests
    const dispatcher = {
      useId: () => 'wizard-mapping-uid-crm2',
      useRef: (init: unknown) => ({ current: init }),
      useEffect: () => {},
      useState: (init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, () => {}],
    };
    const internals = (React as Record<string, unknown>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as {
      H: unknown;
    };
    if (internals) {
      internals.H = dispatcher;
    }
  });

  // ---------------------------------------------------------------------------
  // 1. Target Schema Metadata Registration in Migration Kit (AC 1)
  // ---------------------------------------------------------------------------
  describe('1. Target Schema Metadata Registration in Migration Kit', () => {
    it('registers all 4 CRM-2 target entities in CRM_TARGET_ENTITIES', () => {
      expect(CRM_TARGET_ENTITIES.crm2_deals).toBeDefined();
      expect(CRM_TARGET_ENTITIES.crm2_quotes).toBeDefined();
      expect(CRM_TARGET_ENTITIES.crm2_stages).toBeDefined();
      expect(CRM_TARGET_ENTITIES.crm2_quote_lines).toBeDefined();
    });

    it('getCrm2TargetEntityDefinitions() returns definitions for all CRM-2 entities', () => {
      const defs = getCrm2TargetEntityDefinitions();
      expect(defs.length).toBe(4);
      const keys = defs.map((d) => d.entity);
      expect(keys).toContain('crm2_deals');
      expect(keys).toContain('crm2_quotes');
      expect(keys).toContain('crm2_stages');
      expect(keys).toContain('crm2_quote_lines');
    });

    it('getCrm2TargetEntity() retrieves specific entity definition with module = "crm-2"', () => {
      const dealsDef = getCrm2TargetEntity('crm2_deals');
      expect(dealsDef).toBeDefined();
      expect(dealsDef?.module).toBe('crm-2');
      expect(dealsDef?.label).toBe('CRM-2 Deals');
      expect(dealsDef?.fields).toEqual(CRM2_DEALS_TARGET_FIELDS);

      const quotesDef = getCrm2TargetEntity('crm2_quotes');
      expect(quotesDef?.module).toBe('crm-2');
      expect(quotesDef?.fields).toEqual(CRM2_QUOTES_TARGET_FIELDS);

      const stagesDef = getCrm2TargetEntity('crm2_stages');
      expect(stagesDef?.module).toBe('crm-2');
      expect(stagesDef?.fields).toEqual(CRM2_STAGES_TARGET_FIELDS);

      const quoteLinesDef = getCrm2TargetEntity('crm2_quote_lines');
      expect(quoteLinesDef?.module).toBe('crm-2');
      expect(quoteLinesDef?.fields).toEqual(CRM2_QUOTE_LINES_TARGET_FIELDS);
    });

    it('returns undefined for non-existent target entities', () => {
      expect(getCrm2TargetEntity('non_existent')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Field Definitions, Data Types & Required Badges (AC 2)
  // ---------------------------------------------------------------------------
  describe('2. Dynamic Field Definitions, Data Types and Required Constraints', () => {
    it('crm2_deals specifies correct data types and required badges', () => {
      const def = CRM2_TARGET_ENTITIES.crm2_deals;
      const nameField = def.fields.find((f) => f.name === 'name');
      expect(nameField?.required).toBe(true);
      expect(nameField?.dataType).toBe('string');

      const valueField = def.fields.find((f) => f.name === 'value');
      expect(valueField?.required).toBe(true);
      expect(valueField?.dataType).toBe('number');

      const currencyField = def.fields.find((f) => f.name === 'currency');
      expect(currencyField?.required).toBe(true);
      expect(currencyField?.dataType).toBe('string');

      const stageField = def.fields.find((f) => f.name === 'stage_name');
      expect(stageField?.required).toBe(true);
      expect(stageField?.dataType).toBe('enum');
      expect(stageField?.allowedValues).toEqual([
        'New',
        'Qualified',
        'Proposal',
        'Negotiation',
        'Won',
        'Lost',
      ]);

      const contactIdField = def.fields.find((f) => f.name === 'contact_id');
      expect(contactIdField?.required).toBe(false);
      expect(contactIdField?.dataType).toBe('uuid');

      const closeDateField = def.fields.find((f) => f.name === 'close_date');
      expect(closeDateField?.required).toBe(false);
      expect(closeDateField?.dataType).toBe('date');
    });

    it('crm2_quotes enforces required quote_number, deal_id, quote_date, amount, currency', () => {
      const def = CRM2_TARGET_ENTITIES.crm2_quotes;
      const qNumField = def.fields.find((f) => f.name === 'quote_number');
      expect(qNumField?.required).toBe(true);
      expect(qNumField?.dataType).toBe('string');

      const dealIdField = def.fields.find((f) => f.name === 'deal_id');
      expect(dealIdField?.required).toBe(true);
      expect(dealIdField?.dataType).toBe('uuid');

      const qDateField = def.fields.find((f) => f.name === 'quote_date');
      expect(qDateField?.required).toBe(true);
      expect(qDateField?.dataType).toBe('date');

      const amountField = def.fields.find((f) => f.name === 'amount');
      expect(amountField?.required).toBe(true);
      expect(amountField?.dataType).toBe('number');

      const currencyField = def.fields.find((f) => f.name === 'currency');
      expect(currencyField?.required).toBe(true);
      expect(currencyField?.dataType).toBe('string');

      const noteField = def.fields.find((f) => f.name === 'note');
      expect(noteField?.required).toBe(false);
      expect(noteField?.dataType).toBe('string');
    });

    it('crm2_stages enforces required name enum, position number, and is_won boolean', () => {
      const def = CRM2_TARGET_ENTITIES.crm2_stages;
      const nameField = def.fields.find((f) => f.name === 'name');
      expect(nameField?.required).toBe(true);
      expect(nameField?.dataType).toBe('enum');
      expect(nameField?.allowedValues).toEqual([
        'New',
        'Qualified',
        'Proposal',
        'Negotiation',
        'Won',
        'Lost',
      ]);

      const posField = def.fields.find((f) => f.name === 'position');
      expect(posField?.required).toBe(true);
      expect(posField?.dataType).toBe('number');

      const wonField = def.fields.find((f) => f.name === 'is_won');
      expect(wonField?.required).toBe(true);
      expect(wonField?.dataType).toBe('boolean');
    });

    it('crm2_quote_lines enforces required quote_id, line_number, description, quantity, unit_price', () => {
      const def = CRM2_TARGET_ENTITIES.crm2_quote_lines;
      expect(def.fields.find((f) => f.name === 'quote_id')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'line_number')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'description')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'quantity')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'unit_price')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'product_id')?.required).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Type Compatibility Checking & Incompatible Type Warnings (AC 3)
  // ---------------------------------------------------------------------------
  describe('3. Type Compatibility Checker & Operator Warning Rules', () => {
    it('accepts any source type when target is string', () => {
      expect(checkFieldTypeCompatibility('integer', 'string').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('date', 'string').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('uuid', 'string').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('boolean', 'string').compatible).toBe(true);
    });

    it('accepts compatible numeric source types for number targets', () => {
      expect(checkFieldTypeCompatibility('integer', 'number').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('float', 'number').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('numeric', 'number').compatible).toBe(true);
    });

    it('warns when mapping incompatible source types to number target', () => {
      const dateCheck = checkFieldTypeCompatibility('date', 'number');
      expect(dateCheck.compatible).toBe(false);
      expect(dateCheck.warning).toContain('cannot be safely converted to numeric');

      const boolCheck = checkFieldTypeCompatibility('boolean', 'number');
      expect(boolCheck.compatible).toBe(false);

      const uuidCheck = checkFieldTypeCompatibility('uuid', 'number');
      expect(uuidCheck.compatible).toBe(false);
    });

    it('accepts compatible date source types for date targets', () => {
      expect(checkFieldTypeCompatibility('date', 'date').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('datetime', 'date').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('timestamp', 'date').compatible).toBe(true);
    });

    it('warns when mapping non-date source types to date targets', () => {
      const intCheck = checkFieldTypeCompatibility('integer', 'date');
      expect(intCheck.compatible).toBe(false);
      expect(intCheck.warning).toContain('not a recognized date/time type');

      const boolCheck = checkFieldTypeCompatibility('boolean', 'date');
      expect(boolCheck.compatible).toBe(false);
    });

    it('warns when mapping numeric or date source types to uuid target', () => {
      const intCheck = checkFieldTypeCompatibility('integer', 'uuid');
      expect(intCheck.compatible).toBe(false);
      expect(intCheck.warning).toContain('UUID formatting');
    });

    it('warns when mapping incompatible types to enum targets', () => {
      const numCheck = checkFieldTypeCompatibility('integer', 'enum');
      expect(numCheck.compatible).toBe(false);
      expect(numCheck.warning).toContain('enum allowlists');

      expect(checkFieldTypeCompatibility('enum', 'enum').compatible).toBe(true);
      expect(checkFieldTypeCompatibility('string', 'enum').compatible).toBe(true);
    });

    it('evaluateMappingCompatibility() collects all incompatible mapping warnings across fields', () => {
      const targetFields = CRM2_DEALS_TARGET_FIELDS;
      const fieldMappings = {
        name: 'col_deal_name',
        value: 'col_close_date', // Incompatible: date -> number
        currency: 'col_currency',
        stage_name: 'col_stage_number', // Incompatible: integer -> enum
        contact_id: 'col_contact_count', // Incompatible: integer -> uuid
      };
      const sourceColumnTypes = {
        col_deal_name: 'string',
        col_close_date: 'date',
        col_currency: 'string',
        col_stage_number: 'integer',
        col_contact_count: 'integer',
      };

      const warnings = evaluateMappingCompatibility(fieldMappings, targetFields, sourceColumnTypes);
      expect(warnings.length).toBe(3);

      const valueWarning = warnings.find((w) => w.targetField === 'value');
      expect(valueWarning).toBeDefined();
      expect(valueWarning?.sourceType).toBe('date');
      expect(valueWarning?.targetType).toBe('number');

      const stageWarning = warnings.find((w) => w.targetField === 'stage_name');
      expect(stageWarning).toBeDefined();
      expect(stageWarning?.sourceType).toBe('integer');
      expect(stageWarning?.targetType).toBe('enum');

      const contactWarning = warnings.find((w) => w.targetField === 'contact_id');
      expect(contactWarning).toBeDefined();
      expect(contactWarning?.sourceType).toBe('integer');
      expect(contactWarning?.targetType).toBe('uuid');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Required Unmapped Fields Prevent Proceeding (AC 4)
  // ---------------------------------------------------------------------------
  describe('4. Required Unmapped Fields Execution Gating', () => {
    it('sets canProceed = false when required target fields are missing', () => {
      const targetEntity = CRM2_TARGET_ENTITIES.crm2_deals;
      const incompleteMappings = {
        name: 'Opportunity Name',
        // value is missing (required)
        // currency is missing (required)
        stage_name: 'Stage',
      };

      const result = validateCrm2WizardMapping(incompleteMappings, targetEntity);
      expect(result.canProceed).toBe(false);
      expect(result.missingRequiredFields).toContain('value');
      expect(result.missingRequiredFields).toContain('currency');
      expect(result.errors.length).toBe(2);
    });

    it('sets canProceed = true when all required target fields are mapped even if optional fields are missing', () => {
      const targetEntity = CRM2_TARGET_ENTITIES.crm2_deals;
      const completeMappings = {
        name: 'Opportunity Name',
        value: 'Deal Amount',
        currency: 'ISO Currency',
        stage_name: 'Stage',
        // contact_id is omitted (optional orphan deal permitted)
        // close_date is omitted (optional)
      };

      const result = validateCrm2WizardMapping(completeMappings, targetEntity);
      expect(result.canProceed).toBe(true);
      expect(result.missingRequiredFields.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('assertDryRunEligible() throws AppError(MAPPING_INCOMPLETE) when required fields are unmapped', () => {
      const targetEntity = CRM2_TARGET_ENTITIES.crm2_quotes;
      const incompleteMappings = {
        quote_number: 'Q-001',
        deal_id: 'd-1234',
        // quote_date is missing (required)
        // amount is missing (required)
      };

      expect(() => {
        assertDryRunEligible(incompleteMappings, targetEntity);
      }).toThrowError(/Cannot proceed to dry-run or load: 3 required field\(s\) unmapped/);
    });

    it('assertDryRunEligible() succeeds when all required target fields are mapped', () => {
      const targetEntity = CRM2_TARGET_ENTITIES.crm2_quotes;
      const completeMappings = {
        quote_number: 'Q-001',
        deal_id: 'd-1234',
        quote_date: '2026-10-24',
        amount: '15000',
        currency: 'USD',
      };

      expect(() => {
        assertDryRunEligible(completeMappings, targetEntity);
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Wizard Component Rendering Tests (UI Integration)
  // ---------------------------------------------------------------------------
  describe('5. Wizard Mapping UI Component Rendering', () => {
    it('renders MappingScreen with dynamic CRM-2 target fields, data types, and required badges', () => {
      const element = React.createElement(MappingScreen, {
        batchId: 'test-batch-crm2-1',
        module: 'crm-2',
        sourceColumns: ['name', 'value', 'currency', 'stage_name', 'close_date'],
        sourceColumnTypes: {
          name: 'string',
          value: 'number',
          currency: 'string',
          stage_name: 'string',
          close_date: 'date',
        },
        targetFields: CRM2_DEALS_TARGET_FIELDS,
      });

      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.batchId).toBe('test-batch-crm2-1');
      expect(element.props.module).toBe('crm-2');
      expect(element.props.targetFields.length).toBe(CRM2_DEALS_TARGET_FIELDS.length);
    });

    it('renders WizardMappingPage with target entity switcher and preloaded CRM-2 metadata', () => {
      const element = React.createElement(WizardMappingPage, {
        batchId: 'crm2-batch-101',
        initialEntity: 'crm2_deals',
        sourceColumns: ['name', 'value', 'currency', 'stage_name'],
        sourceColumnTypes: {
          name: 'string',
          value: 'number',
          currency: 'string',
          stage_name: 'string',
        },
      });

      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.initialEntity).toBe('crm2_deals');
    });

    it('renders type incompatibility warning pills when incompatible types are supplied', () => {
      const incompatibleTypes: Record<string, string> = {
        col_date_value: 'date',
      };
      const element = React.createElement(MappingScreen, {
        batchId: 'test-incompat-crm2',
        module: 'crm-2',
        sourceColumns: ['col_date_value'],
        sourceColumnTypes: incompatibleTypes,
        targetFields: [
          { name: 'value', label: 'Deal Value', required: true, dataType: 'number' },
        ],
      });

      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.sourceColumnTypes?.col_date_value).toBe('date');
    });
  });
});
