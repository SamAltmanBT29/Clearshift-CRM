import React, { useState, useId, Suspense } from 'react';
import type { MappingTemplate, TargetEntityDefinition } from '@clearshift/contracts';
import { CRM5_TARGET_ENTITIES } from '@clearshift/contracts';
import type { MappingScreenProps } from '../../../../../migration-kit/web/src/pages/MappingScreen.js';

const MappingScreen = React.lazy(() =>
  import('../../../../../migration-kit/web/src/pages/MappingScreen.js').then((mod) => ({
    default: mod.MappingScreen,
  }))
);

export type Crm5TargetEntityKey =
  | 'crm5_runs'
  | 'crm5_scores'
  | 'crm5_rejects'
  | 'crm5_reconciliation_reports';

export interface WizardMappingPageProps {
  batchId?: string;
  initialEntity?: Crm5TargetEntityKey;
  sourceColumns?: string[];
  sourceColumnTypes?: Record<string, string>;
  sampleData?: Record<string, string>[];
  templates?: MappingTemplate[];
  activeTemplate?: MappingTemplate | null;
  isLoading?: boolean;
  onSaveTemplate?: (template: MappingTemplate) => Promise<void> | void;
  onApplyMapping?: (template: MappingTemplate) => Promise<void> | void;
}

const DEFAULT_SOURCE_COLUMNS = [
  'RunId',
  'BatchId',
  'TargetModule',
  'PipelinePhase',
  'ExecutionState',
  'TotalSourceRows',
  'SuccessfulRows',
  'FailedRows',
  'StartTime',
  'EndTime',
];

const DEFAULT_SOURCE_TYPES: Record<string, string> = {
  RunId: 'uuid',
  BatchId: 'string',
  TargetModule: 'string',
  PipelinePhase: 'string',
  ExecutionState: 'string',
  TotalSourceRows: 'integer',
  SuccessfulRows: 'integer',
  FailedRows: 'integer',
  StartTime: 'date',
  EndTime: 'date',
};

/**
 * CRM-5 Migration Control Center: Wizard Mapping Integration Page
 *
 * Integrates CRM-5 target schema metadata (crm5_runs, crm5_scores, crm5_rejects,
 * crm5_reconciliation_reports) with the shared Migration Kit wizard mapping screen.
 * Dynamically provides target fields, data types, required badges, and type compatibility checking.
 */
export const WizardMappingPage: React.FC<WizardMappingPageProps> = ({
  batchId = 'batch-crm5-preview',
  initialEntity = 'crm5_runs',
  sourceColumns = DEFAULT_SOURCE_COLUMNS,
  sourceColumnTypes = DEFAULT_SOURCE_TYPES,
  sampleData = [],
  templates = [],
  activeTemplate = null,
  isLoading = false,
  onSaveTemplate,
  onApplyMapping,
}) => {
  const [selectedEntityKey, setSelectedEntityKey] = useState<Crm5TargetEntityKey>(initialEntity);
  const entitySelectId = useId();

  const currentEntity: TargetEntityDefinition =
    (CRM5_TARGET_ENTITIES[selectedEntityKey] ?? CRM5_TARGET_ENTITIES['crm5_runs']) as TargetEntityDefinition;

  return (
    <div className="crm5-wizard-mapping-container" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Target Entity Switcher Bar */}
      <div
        className="cs-entity-selector-bar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '16px 20px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label
            htmlFor={entitySelectId}
            style={{ fontWeight: 600, fontSize: '14px', color: '#1e293b' }}
          >
            Target CRM-5 Entity:
          </label>
          <select
            id={entitySelectId}
            aria-label="Select Target CRM-5 Entity"
            value={selectedEntityKey}
            onChange={(e) => setSelectedEntityKey(e.target.value as Crm5TargetEntityKey)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#ffffff',
              fontSize: '14px',
              fontWeight: 500,
              color: '#0f172a',
            }}
          >
            <option value="crm5_runs">CRM-5 Run Projections (crm5_runs)</option>
            <option value="crm5_scores">CRM-5 Quality Scores (crm5_scores)</option>
            <option value="crm5_rejects">CRM-5 Migration Rejections (crm5_rejects)</option>
            <option value="crm5_reconciliation_reports">
              CRM-5 Reconciliation Reports (crm5_reconciliation_reports)
            </option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              backgroundColor: '#e0e7ff',
              color: '#3730a3',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Module: crm-5
          </span>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              backgroundColor: '#dbeafe',
              color: '#1e40af',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Fields: {currentEntity.fields.length}
          </span>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 600,
            }}
          >
            Required: {currentEntity.fields.filter((f) => f.required).length}
          </span>
        </div>
      </div>

      {/* Shared Migration Kit Mapping Screen with dynamically injected CRM-5 metadata */}
      <Suspense fallback={<div className="cs-loading-indicator" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading mapping wizard...</div>}>
        <MappingScreen
          batchId={batchId}
          module="crm-5"
          sourceColumns={sourceColumns}
          sourceColumnTypes={sourceColumnTypes}
          sampleData={sampleData}
          targetFields={currentEntity.fields}
          templates={templates}
          activeTemplate={activeTemplate}
          isLoading={isLoading}
          onSaveTemplate={onSaveTemplate}
          onApplyMapping={onApplyMapping}
        />
      </Suspense>
    </div>
  );
};
