import React, { useState } from 'react';
import {
  MAPPING_TEMPLATES,
  ENUMS,
  templateChecksum,
  type MappingTemplate,
  type Crm4TargetEntity,
} from '../../src/kit/mapping-defaults.js';

export interface MappingTemplatesPageProps {
  initialEntity?: Crm4TargetEntity;
}

export const MappingTemplatesPage: React.FC<MappingTemplatesPageProps> = ({
  initialEntity = 'crm4_lists',
}) => {
  const [selectedEntity, setSelectedEntity] = useState<Crm4TargetEntity>(initialEntity);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialEntity === 'crm4_lists'
      ? 'crm4-lists-canonical'
      : initialEntity === 'crm4_campaigns'
      ? 'crm4-campaigns-canonical'
      : initialEntity === 'crm4_members'
      ? 'crm4-members-canonical'
      : 'crm4-consents-canonical'
  );
  const [showEnumDictionary, setShowEnumDictionary] = useState<boolean>(false);

  const entityTemplates = MAPPING_TEMPLATES.filter((t) => t.entity === selectedEntity);
  const currentTemplate: MappingTemplate =
    entityTemplates.find((t) => t.id === selectedTemplateId) || entityTemplates[0] || MAPPING_TEMPLATES[0]!;

  const checksum = templateChecksum(currentTemplate);
  const requiredFields = currentTemplate.fields.filter((f) => f.required);

  const handleEntityChange = (entity: Crm4TargetEntity) => {
    setSelectedEntity(entity);
    const first = MAPPING_TEMPLATES.find((t) => t.entity === entity);
    if (first) {
      setSelectedTemplateId(first.id);
    }
  };

  return (
    <div className="cs-page-container" style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div className="cs-page-header" style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#0f172a', margin: '0 0 8px 0' }}>
          Field Mapping & Enum Translation Configurations
        </h2>
        <p className="cs-page-desc" style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
          Manage deterministic source-to-target field mappings, type coercion rules, enum allowlists, and required target column enforcement guards for CRM-4.
        </p>
      </div>

      {/* Domain Rule Banner: BR-CRM4-01 */}
      <div
        style={{
          background: '#f8fafc',
          border: '1px solid #cbd5e1',
          borderLeft: '4px solid #0284c7',
          padding: '12px 16px',
          borderRadius: '4px',
          marginBottom: '20px',
        }}
      >
        <strong style={{ color: '#0f172a' }}>BR-CRM4-01 Monotonic Opt-Out Rule:</strong>
        <span style={{ color: '#334155', marginLeft: '6px' }}>
          Unsubscribe/opt-out status is strictly monotonic. Migration and batch imports cannot overwrite a known no-consent status with consent.
        </span>
      </div>

      {/* Entity Selection Tabs */}
      <div
        className="cs-tabs-container"
        style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0' }}
      >
        <button
          type="button"
          onClick={() => handleEntityChange('crm4_lists')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm4_lists' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm4_lists' ? 600 : 400,
            color: selectedEntity === 'crm4_lists' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Marketing Lists (crm4_lists)
        </button>
        <button
          type="button"
          onClick={() => handleEntityChange('crm4_campaigns')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm4_campaigns' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm4_campaigns' ? 600 : 400,
            color: selectedEntity === 'crm4_campaigns' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Campaign History (crm4_campaigns)
        </button>
        <button
          type="button"
          onClick={() => handleEntityChange('crm4_members')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm4_members' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm4_members' ? 600 : 400,
            color: selectedEntity === 'crm4_members' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Campaign Members (crm4_members)
        </button>
        <button
          type="button"
          onClick={() => handleEntityChange('crm4_consents')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm4_consents' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm4_consents' ? 600 : 400,
            color: selectedEntity === 'crm4_consents' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Consent State (crm4_consents)
        </button>
      </div>

      {/* Template Header & Switcher */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <label htmlFor="template-select" style={{ fontSize: '13px', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
              Active Template:
            </label>
            <select
              id="template-select"
              value={currentTemplate.id}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '14px',
                color: '#0f172a',
                minWidth: '320px',
              }}
            >
              {entityTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (v{t.version})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowEnumDictionary(!showEnumDictionary)}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: showEnumDictionary ? '#eff6ff' : '#fff',
              color: showEnumDictionary ? '#1d4ed8' : '#334155',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '14px',
            }}
          >
            {showEnumDictionary ? 'Hide Enum Dictionaries' : 'View Enum Dictionaries'}
          </button>
        </div>

        {/* Template Metadata Pill Cards */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Template ID:</span> <code>{currentTemplate.id}</code>
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Version:</span> {currentTemplate.version}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Target Entity:</span> {currentTemplate.entity}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Mapped Fields:</span> {currentTemplate.fields.length}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>Mandatory Fields:</span> {requiredFields.length}
          </div>
          <div style={{ fontSize: '12px', color: '#64748b', wordBreak: 'break-all' }}>
            <span style={{ fontWeight: 600 }}>SHA-256 Digest:</span> <code style={{ fontSize: '11px' }}>{checksum.slice(0, 16)}...</code>
          </div>
        </div>
      </div>

      {/* Enum Dictionary Drawer (if toggled) */}
      {showEnumDictionary && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px',
          }}
        >
          <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#0f172a', margin: '0 0 16px 0' }}>
            Enum Translation Dictionaries
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            {Object.entries(ENUMS).map(([enumKey, enumDef]) => (
              <div
                key={enumKey}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  padding: '12px',
                }}
              >
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>
                  {enumKey} Allowlist:
                </h4>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  {enumDef.allowlist.map((item) => (
                    <span
                      key={item}
                      style={{
                        background: '#dbeafe',
                        color: '#1e40af',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: 500,
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  <strong>Synonym Translations:</strong> {Object.keys(enumDef.translations).length} aliases mapped.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Field Mappings Table */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Source Column</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Target Attribute</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Coercion Type</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Required Guard</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Enum Mapping</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Default / Blank Rule</th>
            </tr>
          </thead>
          <tbody>
            {currentTemplate.fields.map((f, idx) => (
              <tr
                key={`${f.source}-${f.target}`}
                style={{
                  borderBottom: idx === currentTemplate.fields.length - 1 ? 'none' : '1px solid #f1f5f9',
                  background: f.required ? '#fefce8' : '#fff',
                }}
              >
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#0f172a' }}>
                  {f.source}
                  {f.alternateSources && f.alternateSources.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                      aliases: {f.alternateSources.join(', ')}
                    </div>
                  )}
                </td>
                <td style={{ padding: '12px 16px', fontWeight: 500, color: '#1e293b' }}>
                  {f.target}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span
                    style={{
                      background: '#f1f5f9',
                      color: '#475569',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                    }}
                  >
                    {f.type}
                  </span>
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {f.required ? (
                    <span
                      style={{
                        background: '#fee2e2',
                        color: '#991b1b',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      MANDATORY
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Optional</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  {f.enumName ? (
                    <span
                      style={{
                        background: '#e0e7ff',
                        color: '#3730a3',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'monospace',
                      }}
                    >
                      {f.enumName}
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>
                  {f.defaultValue !== undefined ? (
                    <code>{String(f.defaultValue)}</code>
                  ) : f.omitWhenBlank ? (
                    <em>Omit when blank</em>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>null</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MappingTemplatesPage;
