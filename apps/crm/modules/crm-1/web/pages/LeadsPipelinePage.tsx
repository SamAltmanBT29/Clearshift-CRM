import React, { useEffect, useState } from 'react';
import {
  CRM1_LEAD_STATUS_TRANSITIONS,
  CRM1LeadReadSchema,
  type CRM1LeadRead,
  type CRM1LeadStatus,
} from '@clearshift/contracts/crm-1';

export interface LeadsPipelinePageProps {
  leads?: readonly CRM1LeadRead[];
  total?: number;
  page?: number;
  pageSize?: number;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  onStatusChange?: (leadId: string, status: CRM1LeadStatus) => CRM1LeadRead | Promise<CRM1LeadRead>;
  onPageChange?: (page: number) => void;
}

export const LeadsPipelinePage: React.FC<LeadsPipelinePageProps> = ({
  leads,
  total,
  page = 1,
  pageSize = 25,
  isLoading = false,
  isEmpty = leads === undefined || leads.length === 0,
  error = null,
  onStatusChange,
  onPageChange,
}) => {
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [leadOverrides, setLeadOverrides] = useState<Record<string, CRM1LeadRead>>({});
  const resultCount = total ?? leads?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(resultCount / pageSize));
  const rows = (leads ?? []).map((lead) => leadOverrides[lead.id] ?? lead);
  const empty = leads === undefined ? isEmpty : leads.length === 0;

  useEffect(() => {
    setLeadOverrides({});
  }, [leads]);

  const changeStatus = async (leadId: string, status: CRM1LeadStatus) => {
    if (!onStatusChange) return;
    setPendingLeadId(leadId);
    setActionError(null);
    try {
      const updated = CRM1LeadReadSchema.parse(await onStatusChange(leadId, status));
      if (updated.id !== leadId || updated.status !== status) {
        throw new Error('The API returned a different lead or status than requested.');
      }
      setLeadOverrides((current) => ({ ...current, [leadId]: updated }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Lead status update failed.');
    } finally {
      setPendingLeadId(null);
    }
  };

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Leads Pipeline</h2>
        <p className="cs-page-desc">
          Track prospective sales opportunities through verified lifecycle stages: New, Working, Qualified, and Closed.
        </p>
      </div>

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading leads pipeline">
          <div className="cs-skeleton-line" style={{ width: '100%' }} />
          <div className="cs-skeleton-line" style={{ width: '90%' }} />
          <p className="cs-loading-text">Loading leads from server...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading leads: {error}</p>
        </div>
      )}

      {!isLoading && !error && empty && (
        <div className="cs-empty-state" role="status">
          <h3 className="cs-empty-title">No records found</h3>
          <p className="cs-empty-text">
            No leads are available. Create a lead or import prospects from a source system.
          </p>
        </div>
      )}

      {!isLoading && !error && !empty && (
        <section id="leads-container" aria-label="Leads">
          <p className="cs-result-count">{resultCount} leads</p>
          {actionError && (
            <div className="cs-error-card" role="alert">
              <p className="cs-error-message">{actionError}</p>
            </div>
          )}
          <div className="cs-table-scroll">
            <table className="cs-data-table">
              <thead>
                <tr>
                  <th scope="col">Contact</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  {onStatusChange && <th scope="col">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => {
                  const nextStatuses = CRM1_LEAD_STATUS_TRANSITIONS[lead.status];
                  return (
                    <tr key={lead.id}>
                      <th scope="row">{lead.contactName}</th>
                      <td>{lead.contactEmail ?? 'Not provided'}</td>
                      <td>{lead.status}</td>
                      {onStatusChange && (
                        <td>
                          {nextStatuses.map((status) => (
                            <button
                              key={status}
                              type="button"
                              className="cs-action-button"
                              aria-label={`Move ${lead.contactName} to ${status}`}
                              disabled={pendingLeadId !== null}
                              onClick={() => void changeStatus(lead.id, status)}
                            >
                              {pendingLeadId === lead.id ? 'Updating...' : `Move to ${status}`}
                            </button>
                          ))}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {onPageChange && (
            <nav className="cs-pagination" aria-label="Lead list pages">
              <button type="button" className="cs-action-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Previous
              </button>
              <span>Page {page} of {pageCount}</span>
              <button
                type="button"
                className="cs-action-button"
                disabled={page >= pageCount}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </section>
      )}
    </div>
  );
};
