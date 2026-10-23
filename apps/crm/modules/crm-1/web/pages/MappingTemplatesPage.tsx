import React, { useState } from 'react';
import {
  MAPPING_TEMPLATES,
  ENUMS,
  templateChecksum,
  type MappingTemplate,
  type Crm1TargetEntity,
} from '../../src/kit/mapping-defaults.js';

export interface MappingTemplatesPageProps {
  initialEntity?: Crm1TargetEntity;
}

export const MappingTemplatesPage: React.FC<MappingTemplatesPageProps> = ({
  initialEntity = 'crm1_contacts',
}) => {
  const [selectedEntity, setSelectedEntity] = useState<Crm1TargetEntity>(initialEntity);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialEntity === 'crm1_contacts'
      ? 'crm1-contacts-canonical'
      : initialEntity === 'crm1_companies'
      ? 'crm1-companies-canonical'
      : 'crm1-leads-canonical'
  );
  const [showEnumDictionary, setShowEnumDictionary] = useState<boolean>(false);

  const entityTemplates = MAPPING_TEMPLATES.filter((t) => t.entity === selectedEntity);
  const currentTemplate: MappingTemplate =
    entityTemplates.find((t) => t.id === selectedTemplateId) || entityTemplates[0] || MAPPING_TEMPLATES[0]!;

  const checksum = templateChecksum(currentTemplate);
  const requiredFields = currentTemplate.fields.filter((f) => f.required);

  const handleEntityChange = (entity: Crm1TargetEntity) => {
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
          Manage deterministic source-to-target field mappings, type coercion rules, enum allowlists, and required target column enforcement guards.
        </p>
      </div>

      {/* Entity Selection Tabs */}
      <div
        className="cs-tabs-container"
        style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0' }}
      >
        <button
          type="button"
          onClick={() => handleEntityChange('crm1_contacts')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm1_contacts' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm1_contacts' ? 600 : 400,
            color: selectedEntity === 'crm1_contacts' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Contacts (crm1_contacts)
        </button>
        <button
          type="button"
          onClick={() => handleEntityChange('crm1_companies')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm1_companies' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm1_companies' ? 600 : 400,
            color: selectedEntity === 'crm1_companies' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Companies (crm1_companies)
        </button>
        <button
          type="button"
          onClick={() => handleEntityChange('crm1_leads')}
          style={{
            padding: '10px 18px',
            border: 'none',
            borderBottom: selectedEntity === 'crm1_leads' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            fontWeight: selectedEntity === 'crm1_leads' ? 600 : 400,
            color: selectedEntity === 'crm1_leads' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Leads (crm1_leads)
        </button>
      </div>

      {/* Template Metadata & Sub-selection Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#2563eb',
                letterSpacing: '0.05em',
              }}
            >
              Active Template
            </span>
            <h3 style={{ margin: '4px 0 0 0', fontSize: '18px', color: '#0f172a' }}>{currentTemplate.name}</h3>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {entityTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplateId(t.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  border: t.id === currentTemplate.id ? '1px solid #2563eb' : '1px solid #cbd5e1',
                  background: t.id === currentTemplate.id ? '#eff6ff' : '#ffffff',
                  color: t.id === currentTemplate.id ? '#1d4ed8' : '#475569',
                  cursor: 'pointer',
                  fontWeight: t.id === currentTemplate.id ? 600 : 400,
                }}
              >
                {t.name.includes('Legacy') ? 'Legacy Export' : 'Canonical'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
          <div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Template ID</span>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155', fontFamily: 'monospace' }}>
              {currentTemplate.id}
            </div>
          </div>
          <div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Version</span>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              v{currentTemplate.version}.0.0
            </div>
          </div>
          <div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>Required Fields</span>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#16a34a' }}>
              {requiredFields.length} Mandatory
            </div>
          </div>
          <div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>SHA-256 Checksum</span>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#64748b',
                fontFamily: 'monospace',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={checksum}
            >
              {checksum.substring(0, 16)}...
            </div>
          </div>
        </div>
      </div>

      {/* Required Target Field Enforcement Notice */}
      <div
        style={{
          background: '#f8fafc',
          borderLeft: '4px solid #2563eb',
          padding: '12px 16px',
          marginBottom: '20px',
          borderRadius: '4px',
        }}
      >
        <strong style={{ fontSize: '13px', color: '#1e293b' }}>Dry-Run Guard Enforcement:</strong>
        <span style={{ fontSize: '13px', color: '#475569', marginLeft: '6px' }}>
          Dry-run execution will be strictly halted before any database mutations if incoming source files fail to supply mappings for required target columns:
          {' '}
          <strong>{requiredFields.map((f) => `${f.target} (source: ${f.source})`).join(', ')}</strong>.
        </span>
      </div>

      {/* Field Mapping Table */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          marginBottom: '24px',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Source Column</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Target Schema Field</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Data Type</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Constraint</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Enum / Value Conversion</th>
              <th style={{ padding: '12px 16px', fontWeight: 600 }}>Default Value</th>
            </tr>
          </thead>
          <tbody>
            {currentTemplate.fields.map((f, idx) => (
              <tr
                key={f.target}
                style={{
                  borderBottom: idx < currentTemplate.fields.length - 1 ? '1px solid #f1f5f9' : 'none',
                  background: idx % 2 === 0 ? '#ffffff' : '#fafafa',
                }}
              >
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 600, color: '#1e293b' }}>
                  {f.source}
                </td>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#2563eb' }}>
                  {f.target}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <span
                    style={{
                      background: '#f1f5f9',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#475569',
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
                        color: '#b91c1c',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      Required
                    </span>
                  ) : (
                    <span
                      style={{
                        background: '#f1f5f9',
                        color: '#64748b',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                      }}
                    >
                      Optional
                    </span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', color: '#475569' }}>
                  {f.enumName ? (
                    <span
                      style={{
                        background: '#e0e7ff',
                        color: '#3730a3',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      {f.enumName} ({ENUMS[f.enumName].allowlist.length} allowed)
                    </span>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>
                  {f.defaultValue !== undefined ? String(f.defaultValue) : f.omitWhenBlank ? '(omit when blank)' : 'null'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Collapsible Enum Translation Dictionary Section */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#0f172a' }}>
              Enum Translation Dictionaries & Allowlists
            </h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
              Standardized mapping of source string variations to valid ClearShift domain enums.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowEnumDictionary(!showEnumDictionary)}
            style={{
              padding: '6px 14px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {showEnumDictionary ? 'Hide Dictionaries' : 'View Dictionaries'}
          </button>
        </div>

        {showEnumDictionary && (
          <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px' }}>
              <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block', marginBottom: '8px' }}>
                Lead Status (CRM SDS Allowlist)
              </strong>
              <div style={{ marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ENUMS.lead_status.allowlist.map((status) => (
                  <span
                    key={status}
                    style={{
                      background: '#dbeafe',
                      color: '#1e40af',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {status}
                  </span>
                ))}
              </div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Sample Source Translations:</span>
              <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: '12px', color: '#475569' }}>
                <li><code>open, incoming, uncontacted</code> &rarr; <strong>New</strong></li>
                <li><code>in_progress, contacted, active</code> &rarr; <strong>Working</strong></li>
                <li><code>approved, converted, sql, mql</code> &rarr; <strong>Qualified</strong></li>
                <li><code>won, lost, disqualified, dead</code> &rarr; <strong>Closed</strong></li>
              </ul>
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px' }}>
              <strong style={{ fontSize: '13px', color: '#1e293b', display: 'block', marginBottom: '8px' }}>
                Consent Status
              </strong>
              <div style={{ marginBottom: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {ENUMS.consent_status.allowlist.map((status) => (
                  <span
                    key={status}
                    style={{
                      background: '#dcfce7',
                      color: '#166534',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    {status}
                  </span>
                ))}
              </div>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Sample Source Translations:</span>
              <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: '12px', color: '#475569' }}>
                <li><code>subscribed, opt_in, yes, true, 1</code> &rarr; <strong>granted</strong></li>
                <li><code>opt_out, unsubscribed, no, false, 0</code> &rarr; <strong>withdrawn</strong></li>
                <li><code>pending, none, unspecified</code> &rarr; <strong>unknown</strong></li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
