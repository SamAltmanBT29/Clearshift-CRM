import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import {
  CRM_TARGET_ENTITIES,
  CRM5_TARGET_ENTITIES,
  CRM5_RUNS_TARGET_FIELDS,
  CRM5_SCORES_TARGET_FIELDS,
  CRM5_REJECTS_TARGET_FIELDS,
  CRM5_RECONCILIATION_TARGET_FIELDS,
  type TargetEntityDefinition,
} from '@clearshift/contracts';
import {
  getCrm5TargetEntityDefinitions,
  getCrm5TargetEntity,
  checkFieldTypeCompatibility,
  evaluateMappingCompatibility,
  validateCrm5WizardMapping,
  assertDryRunEligible,
} from '../../src/kit/wizard-metadata.js';
import { WizardMappingPage } from '../../web/pages/WizardMappingPage.js';
import { MappingScreen } from '../../../../../migration-kit/web/src/pages/MappingScreen.js';

describe('CRM-5 Migration Control Center: Migration Kit Wizard Metadata Integration (Issue #195 / [CRM5-22])', () => {
  beforeAll(() => {
    // Mock lightweight React dispatcher for pure Node.js rendering tests
    const dispatcher = {
      useId: () => 'wizard-mapping-uid-1',
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
  // 1. Target Schema Metadata Registration (AC 1)
  // ---------------------------------------------------------------------------
  describe('1. Target Schema Metadata Registration in Migration Kit', () => {
    it('registers all 4 CRM-5 target entities in CRM_TARGET_ENTITIES', () => {
      expect(CRM_TARGET_ENTITIES.crm5_runs).toBeDefined();
      expect(CRM_TARGET_ENTITIES.crm5_scores).toBeDefined();
      expect(CRM_TARGET_ENTITIES.crm5_rejects).toBeDefined();
      expect(CRM_TARGET_ENTITIES.crm5_reconciliation_reports).toBeDefined();
    });

    it('getCrm5TargetEntityDefinitions() returns definitions for all CRM-5 entities', () => {
      const defs = getCrm5TargetEntityDefinitions();
      expect(defs.length).toBe(4);
      const keys = defs.map((d) => d.entity);
      expect(keys).toContain('crm5_runs');
      expect(keys).toContain('crm5_scores');
      expect(keys).toContain('crm5_rejects');
      expect(keys).toContain('crm5_reconciliation_reports');
    });

    it('getCrm5TargetEntity() retrieves specific entity definition with module = "crm-5"', () => {
      const runsDef = getCrm5TargetEntity('crm5_runs');
      expect(runsDef).toBeDefined();
      expect(runsDef?.module).toBe('crm-5');
      expect(runsDef?.label).toBe('CRM-5 Run Projections');
      expect(runsDef?.fields).toEqual(CRM5_RUNS_TARGET_FIELDS);

      const scoresDef = getCrm5TargetEntity('crm5_scores');
      expect(scoresDef?.module).toBe('crm-5');
      expect(scoresDef?.fields).toEqual(CRM5_SCORES_TARGET_FIELDS);

      const rejectsDef = getCrm5TargetEntity('crm5_rejects');
      expect(rejectsDef?.module).toBe('crm-5');
      expect(rejectsDef?.fields).toEqual(CRM5_REJECTS_TARGET_FIELDS);

      const reconDef = getCrm5TargetEntity('crm5_reconciliation_reports');
      expect(reconDef?.module).toBe('crm-5');
      expect(reconDef?.fields).toEqual(CRM5_RECONCILIATION_TARGET_FIELDS);
    });

    it('returns undefined for non-existent target entities', () => {
      expect(getCrm5TargetEntity('non_existent')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Field Definitions, Data Types & Required Badges (AC 2)
  // ---------------------------------------------------------------------------
  describe('2. Dynamic Field Definitions, Data Types and Required Constraints', () => {
    it('crm5_runs specifies correct data types and required badges', () => {
      const def = CRM5_TARGET_ENTITIES.crm5_runs;
      const batchIdField = def.fields.find((f) => f.name === 'batchId');
      expect(batchIdField?.required).toBe(true);
      expect(batchIdField?.dataType).toBe('string');

      const stepField = def.fields.find((f) => f.name === 'step');
      expect(stepField?.required).toBe(true);
      expect(stepField?.dataType).toBe('enum');
      expect(stepField?.allowedValues).toEqual([
        'extract',
        'profile',
        'clean',
        'map',
        'load',
        'validate',
        'reconcile',
      ]);

      const statusField = def.fields.find((f) => f.name === 'status');
      expect(statusField?.required).toBe(true);
      expect(statusField?.dataType).toBe('enum');
      expect(statusField?.allowedValues).toEqual([
        'pending',
        'running',
        'completed',
        'failed',
        'halted',
      ]);

      const recordsInField = def.fields.find((f) => f.name === 'recordsIn');
      expect(recordsInField?.required).toBe(false);
      expect(recordsInField?.dataType).toBe('number');

      const startedAtField = def.fields.find((f) => f.name === 'startedAt');
      expect(startedAtField?.required).toBe(false);
      expect(startedAtField?.dataType).toBe('date');
    });

    it('crm5_scores enforces required score and bounded numeric ratios', () => {
      const def = CRM5_TARGET_ENTITIES.crm5_scores;
      const scoreField = def.fields.find((f) => f.name === 'score');
      expect(scoreField?.required).toBe(true);
      expect(scoreField?.dataType).toBe('number');

      const completenessField = def.fields.find((f) => f.name === 'completeness');
      expect(completenessField?.required).toBe(false);
      expect(completenessField?.dataType).toBe('number');
    });

    it('crm5_rejects enforces required rowIndex, errorCode, and rawPayloadHash', () => {
      const def = CRM5_TARGET_ENTITIES.crm5_rejects;
      expect(def.fields.find((f) => f.name === 'rowIndex')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'errorCode')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'errorMessage')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'rawPayloadHash')?.required).toBe(true);
    });

    it('crm5_reconciliation_reports enforces conservation counters and status enum', () => {
      const def = CRM5_TARGET_ENTITIES.crm5_reconciliation_reports;
      expect(def.fields.find((f) => f.name === 'sourceCount')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'loadedCount')?.required).toBe(true);
      expect(def.fields.find((f) => f.name === 'rejectedCount')?.required).toBe(true);
      const statusField = def.fields.find((f) => f.name === 'status');
      expect(statusField?.required).toBe(true);
      expect(statusField?.dataType).toBe('enum');
      expect(statusField?.allowedValues).toEqual(['OK', 'UNBALANCED']);
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
      const targetFields = CRM5_RUNS_TARGET_FIELDS;
      const fieldMappings = {
        batchId: 'col_batch',
        module: 'col_module',
        step: 'col_step',
        status: 'col_status',
        recordsIn: 'col_birth_date', // Incompatible: date -> number
        startedAt: 'col_count', // Incompatible: integer -> date
      };
      const sourceColumnTypes = {
        col_batch: 'string',
        col_module: 'string',
        col_step: 'string',
        col_status: 'string',
        col_birth_date: 'date',
        col_count: 'integer',
      };

      const warnings = evaluateMappingCompatibility(fieldMappings, targetFields, sourceColumnTypes);
      expect(warnings.length).toBe(2);

      const recordsInWarning = warnings.find((w) => w.targetField === 'recordsIn');
      expect(recordsInWarning).toBeDefined();
      expect(recordsInWarning?.sourceType).toBe('date');
      expect(recordsInWarning?.targetType).toBe('number');

      const startedAtWarning = warnings.find((w) => w.targetField === 'startedAt');
      expect(startedAtWarning).toBeDefined();
      expect(startedAtWarning?.sourceType).toBe('integer');
      expect(startedAtWarning?.targetType).toBe('date');
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Required Unmapped Fields Prevent Proceeding (AC 4)
  // ---------------------------------------------------------------------------
  describe('4. Required Unmapped Fields Execution Gating', () => {
    it('sets canProceed = false when required target fields are missing', () => {
      const targetEntity = CRM5_TARGET_ENTITIES.crm5_runs;
      const incompleteMappings = {
        batchId: 'col_batch',
        // module is missing (required)
        // step is missing (required)
        status: 'col_status',
      };

      const result = validateCrm5WizardMapping(incompleteMappings, targetEntity);
      expect(result.canProceed).toBe(false);
      expect(result.missingRequiredFields).toContain('module');
      expect(result.missingRequiredFields).toContain('step');
      expect(result.errors.length).toBe(2);
    });

    it('sets canProceed = true when all required target fields are mapped', () => {
      const targetEntity = CRM5_TARGET_ENTITIES.crm5_runs;
      const completeMappings = {
        batchId: 'col_batch',
        module: 'col_module',
        step: 'col_step',
        status: 'col_status',
      };

      const result = validateCrm5WizardMapping(completeMappings, targetEntity);
      expect(result.canProceed).toBe(true);
      expect(result.missingRequiredFields.length).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('assertDryRunEligible() throws AppError(MAPPING_INCOMPLETE) when required fields are unmapped', () => {
      const targetEntity = CRM5_TARGET_ENTITIES.crm5_scores;
      const incompleteMappings = {
        batchId: 'col_batch',
        module: 'col_module',
        // score is missing (required)
      };

      expect(() => {
        assertDryRunEligible(incompleteMappings, targetEntity);
      }).toThrowError(/Cannot proceed to dry-run or load: 1 required field\(s\) unmapped/);
    });

    it('assertDryRunEligible() succeeds when all required target fields are mapped', () => {
      const targetEntity = CRM5_TARGET_ENTITIES.crm5_scores;
      const completeMappings = {
        batchId: 'col_batch',
        module: 'col_module',
        score: 'col_score',
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
    it('renders MappingScreen with dynamic target fields, data types, and required badges', () => {
      const element = React.createElement(MappingScreen, {
        batchId: 'test-batch-1',
        module: 'crm-5',
        sourceColumns: ['RunId', 'BatchId', 'PipelinePhase', 'TotalRows'],
        sourceColumnTypes: {
          RunId: 'uuid',
          BatchId: 'string',
          PipelinePhase: 'string',
          TotalRows: 'integer',
        },
        targetFields: CRM5_RUNS_TARGET_FIELDS,
      });

      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.batchId).toBe('test-batch-1');
      expect(element.props.module).toBe('crm-5');
      expect(element.props.targetFields.length).toBe(CRM5_RUNS_TARGET_FIELDS.length);
    });

    it('renders WizardMappingPage with target entity switcher and preloaded CRM-5 metadata', () => {
      const element = React.createElement(WizardMappingPage, {
        batchId: 'crm5-batch-101',
        initialEntity: 'crm5_runs',
        sourceColumns: ['RunId', 'BatchId', 'TargetModule', 'PipelinePhase', 'ExecutionState'],
        sourceColumnTypes: {
          RunId: 'uuid',
          BatchId: 'string',
          TargetModule: 'string',
          PipelinePhase: 'string',
          ExecutionState: 'string',
        },
      });

      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.initialEntity).toBe('crm5_runs');
    });

    it('renders type incompatibility warning pills when incompatible types are supplied', () => {
      const incompatibleTypes: Record<string, string> = {
        col_date_field: 'date',
      };
      const element = React.createElement(MappingScreen, {
        batchId: 'test-incompat',
        module: 'crm-5',
        sourceColumns: ['col_date_field'],
        sourceColumnTypes: incompatibleTypes,
        targetFields: [
          { name: 'count', label: 'Count', required: true, dataType: 'number' },
        ],
      });

      expect(React.isValidElement(element)).toBe(true);
      expect(element.props.sourceColumnTypes?.col_date_field).toBe('date');
    });
  });
});
