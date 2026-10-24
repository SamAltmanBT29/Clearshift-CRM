import React, { useState, useId, Suspense } from 'react';
import type { MappingTemplate, TargetEntityDefinition } from '@clearshift/contracts';
import { CRM2_TARGET_ENTITIES } from '@clearshift/contracts';

const MappingScreen = React.lazy(() =>
  import('../../../../../migration-kit/web/src/pages/MappingScreen.js').then((mod) => ({
    default: mod.MappingScreen,
  }))
);

export type Crm2TargetEntityKey =
  | 'crm2_deals'
  | 'crm2_quotes'
  | 'crm2_stages'
  | 'crm2_quote_lines';

export interface WizardMappingPageProps {
  batchId?: string;
  initialEntity?: Crm2TargetEntityKey;
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
  'name',
  'contact_id',
  'value',
  'currency',
  'stage_name',
  'close_date',
  'source_id',
  'quote_number',
  'deal_id',
  'quote_date',
  'amount',
  'note',
];

const DEFAULT_SOURCE_TYPES: Record<string, string> = {
  name: 'string',
  contact_id: 'uuid',
  value: 'number',
  currency: 'string',
  stage_name: 'string',
  close_date: 'date',
  source_id: 'string',
  quote_number: 'string',
  deal_id: 'uuid',
  quote_date: 'date',
  amount: 'number',
  note: 'string',
};

/**
 * CRM-2 Deals, Pipeline and Quotes: Wizard Mapping Integration Page
 *
 * Integrates CRM-2 target schema metadata (crm2_deals, crm2_quotes, crm2_stages,
 * crm2_quote_lines) with the shared Migration Kit wizard mapping screen.
 * Dynamically provides target fields, data types, required badges, and type compatibility checking.
 */
export const WizardMappingPage: React.FC<WizardMappingPageProps> = ({
  batchId = 'batch-crm2-preview',
  initialEntity = 'crm2_deals',
  sourceColumns = DEFAULT_SOURCE_COLUMNS,
  sourceColumnTypes = DEFAULT_SOURCE_TYPES,
  sampleData = [],
  templates = [],
  activeTemplate = null,
  isLoading = false,
  onSaveTemplate,
  onApplyMapping,
}) => {
  const [selectedEntityKey, setSelectedEntityKey] = useState<Crm2TargetEntityKey>(initialEntity);
  const entitySelectId = useId();

  const currentEntity: TargetEntityDefinition =
    (CRM2_TARGET_ENTITIES[selectedEntityKey] ?? CRM2_TARGET_ENTITIES['crm2_deals']) as TargetEntityDefinition;

  return (
    <div className="crm2-wizard-mapping-container" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
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
            Target CRM-2 Entity:
          </label>
          <select
            id={entitySelectId}
            aria-label="Select Target CRM-2 Entity"
            value={selectedEntityKey}
            onChange={(e) => setSelectedEntityKey(e.target.value as Crm2TargetEntityKey)}
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
            <option value="crm2_deals">CRM-2 Deals (crm2_deals)</option>
            <option value="crm2_quotes">CRM-2 Quotes (crm2_quotes)</option>
            <option value="crm2_stages">CRM-2 Pipeline Stages (crm2_stages)</option>
            <option value="crm2_quote_lines">CRM-2 Quote Lines (crm2_quote_lines)</option>
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
            Module: crm-2
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

      {/* Shared Migration Kit Mapping Screen with dynamically injected CRM-2 metadata */}
      <Suspense fallback={<div className="cs-loading-indicator" style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>Loading mapping wizard...</div>}>
        <MappingScreen
          batchId={batchId}
          module="crm-2"
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
