import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Badge,
  Alert,
  Spinner,
} from '@clearshift/ui';
import {
  type CRM1LeadRead,
  CRM1_LEAD_STATUS_TRANSITIONS,
} from '@clearshift/contracts';
import { getLeadById } from '../api/crm-1.js';

export interface LeadDetailPageProps {
  leadId: string;
  initialLead?: CRM1LeadRead | null | undefined;
  onBackToList: () => void;
  onEditLead: (lead: CRM1LeadRead) => void;
}

export function LeadDetailPage({
  leadId,
  initialLead,
  onBackToList,
  onEditLead,
}: LeadDetailPageProps) {
  const [lead, setLead] = useState<CRM1LeadRead | null>(initialLead ?? null);
  const [isLoading, setIsLoading] = useState(!initialLead);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getLeadById(leadId);
      setLead(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load lead record.');
    } finally {
      setIsLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (!initialLead) {
      loadData();
    }
  }, [loadData, initialLead]);

  const allowedNext = lead ? CRM1_LEAD_STATUS_TRANSITIONS[lead.status] ?? [] : [];

  return (
    <div className="cs-page-container max-w-4xl mx-auto p-6" style={{ maxWidth: '56rem', margin: '0 auto', padding: '24px' }}>
      <div className="mb-6 flex items-center justify-between" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBackToList}
            aria-label="Back to leads pipeline"
            style={{ marginBottom: '12px' }}
          >
            ← Back to Leads
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Lead: {lead?.contactName || leadId}
            </h1>
            {lead?.status && (
              <Badge variant="info">{lead.status}</Badge>
            )}
          </div>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '4px' }}>
            Lead Record ID: <code style={{ fontSize: '0.8125rem' }}>{leadId}</code>
          </p>
        </div>

        {lead && (
          <Button
            type="button"
            variant="primary"
            onClick={() => onEditLead(lead)}
            aria-label="Edit or advance this lead"
          >
            Advance Status
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="error" style={{ marginBottom: '24px' }}>
          {error}
        </Alert>
      )}

      {isLoading ? (
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px' }}>
            <Spinner size="lg" />
            <p style={{ marginTop: '16px', fontSize: '0.875rem', color: '#64748b' }}>
              Loading lead details...
            </p>
          </div>
        </Card>
      ) : lead ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Status Progression Card */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Pipeline Status & Allowed Progression
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Current Stage
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 600, fontSize: '1rem', color: '#0f172a' }}>
                  {lead.status}
                </p>
              </div>
              <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: '16px' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Allowed Next Transitions
                </span>
                <p style={{ margin: '4px 0 0' }}>
                  {allowedNext.length > 0 ? (
                    allowedNext.map((st) => (
                      <Badge key={st} variant="success" style={{ marginRight: '6px' }}>
                        → {st}
                      </Badge>
                    ))
                  ) : (
                    <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                      Terminal State (No further transitions)
                    </span>
                  )}
                </p>
              </div>
            </div>
          </Card>

          {/* Contact Details Card */}
          <Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#0f172a', marginBottom: '16px', borderBottom: '1px solid #f1f5f9', paddingBottom: '8px' }}>
              Associated Contact
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Contact Name
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 600, color: '#0f172a' }}>
                  {lead.contactName || 'N/A'}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Contact Email
                </span>
                <p style={{ margin: '4px 0 0', fontWeight: 500, color: '#0f172a' }}>
                  {lead.contactEmail ? (
                    <a href={`mailto:${lead.contactEmail}`} style={{ color: '#0284c7', textDecoration: 'none' }}>
                      {lead.contactEmail}
                    </a>
                  ) : (
                    <span style={{ color: '#94a3b8' }}>Not provided</span>
                  )}
                </p>
              </div>
              <div>
                <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase' }}>
                  Contact UUID
                </span>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: '#475569' }}>
                  <code>{lead.contactId}</code>
                </p>
              </div>
            </div>
          </Card>

          {/* Audit Timestamps */}
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: '#64748b' }}>
              <span>Created: {new Date(lead.createdAt).toLocaleString()}</span>
              <span>Last Modified: {new Date(lead.updatedAt).toLocaleString()}</span>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
