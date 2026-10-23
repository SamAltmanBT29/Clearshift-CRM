import React, { useState } from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { CLEANING_AUDIT_COLUMNS, CLEANING_REJECTS_COLUMNS } from '../table/columns.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface CleaningAuditPageProps {
  auditEntries?: Record<string, unknown>[];
  rejectEntries?: Record<string, unknown>[];
  summary?: {
    totalRows: number;
    cleanedRows: number;
    rejectedRows: number;
    auditEntriesCount: number;
    byRule?: Record<string, number>;
  };
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | null;
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  pagination?: TablePaginationState | undefined;
  onPageChange?: ((newPage: number) => void) | undefined;
  search?: string;
  onSearchChange?: ((term: string) => void) | undefined;
  filters?: TableFilterState;
  onFilterChange?: ((key: string, value: string) => void) | undefined;
  onRemoveFilter?: ((key: string) => void) | undefined;
  onClearAllFilters?: (() => void) | undefined;
  activePills?: ActiveFilterPill[];
  facets?: FilterFacet[];
  hasActiveFilters?: boolean;
}

/**
 * Cleaning Rules & Field Audit Page Shell
 * Conforms to ClearShift V1 Issue #120 (CRM1-27).
 * Visualizes transformed field audit records and structured row rejections with rule IDs.
 */
export const CleaningAuditPage: React.FC<CleaningAuditPageProps> = ({
  auditEntries = [],
  rejectEntries = [],
  summary = {
    totalRows: 0,
    cleanedRows: 0,
    rejectedRows: 0,
    auditEntriesCount: 0,
    byRule: {},
  },
  isLoading = false,
  isEmpty = false,
  error = null,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 25, total: 0, totalPages: 1 },
  onPageChange,
  search = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  onRemoveFilter,
  onClearAllFilters,
  activePills = [],
  facets = [],
  hasActiveFilters = false,
}) => {
  const [activeTab, setActiveTab] = useState<'audit' | 'rejects'>('audit');

  const currentData = activeTab === 'audit' ? (isEmpty ? [] : auditEntries) : (isEmpty ? [] : rejectEntries);
  const currentColumns = activeTab === 'audit' ? CLEANING_AUDIT_COLUMNS : CLEANING_REJECTS_COLUMNS;

  return (
    <div className="cs-page-container">
      <div className="cs-page-header">
        <h2>Cleaning Rules & Field-Level Audit</h2>
        <p className="cs-page-desc">
          Inspect deterministic field normalizations, before/after audit trails, and structured row-level rejections.
        </p>
      </div>

      {summary.totalRows > 0 && (
        <div className="cs-metrics-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
          <div className="cs-metric-card" style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Total Evaluated</span>
            <strong style={{ display: 'block', fontSize: '24px', color: '#0f172a' }}>{summary.totalRows}</strong>
          </div>
          <div className="cs-metric-card" style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Cleaned Rows</span>
            <strong style={{ display: 'block', fontSize: '24px', color: '#10b981' }}>{summary.cleanedRows}</strong>
          </div>
          <div className="cs-metric-card" style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Rejected Rows</span>
            <strong style={{ display: 'block', fontSize: '24px', color: '#ef4444' }}>{summary.rejectedRows}</strong>
          </div>
          <div className="cs-metric-card" style={{ padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '13px', color: '#64748b' }}>Field Audits Logged</span>
            <strong style={{ display: 'block', fontSize: '24px', color: '#3b82f6' }}>{summary.auditEntriesCount}</strong>
          </div>
        </div>
      )}

      <div className="cs-tabs-container" style={{ display: 'flex', gap: '8px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' }}>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderBottom: activeTab === 'audit' ? '2px solid #3b82f6' : '2px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'audit' ? 600 : 400,
            color: activeTab === 'audit' ? '#1d4ed8' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Field Audit Trail ({auditEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('rejects')}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderBottom: activeTab === 'rejects' ? '2px solid #ef4444' : '2px solid transparent',
            background: 'none',
            fontWeight: activeTab === 'rejects' ? 600 : 400,
            color: activeTab === 'rejects' ? '#dc2626' : '#64748b',
            cursor: 'pointer',
          }}
        >
          Row Rejections ({rejectEntries.length})
        </button>
      </div>

      {onSearchChange && onFilterChange && (
        <FilterToolbar
          search={search}
          onSearchChange={onSearchChange}
          facets={facets}
          filters={filters}
          onFilterChange={onFilterChange}
          activePills={activePills}
          onRemoveFilter={onRemoveFilter ?? (() => {})}
          onClearAll={onClearAllFilters ?? (() => {})}
          searchPlaceholder="Search field audits or rejection reasons..."
        />
      )}

      {isLoading && (
        <div className="cs-skeleton-container" aria-busy="true" aria-label="Loading cleaning records">
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <div className="cs-skeleton-line" style={{ width: '100%', height: '44px' }} />
          <p className="cs-loading-text">Loading cleaning and audit records...</p>
        </div>
      )}

      {!isLoading && error && (
        <div className="cs-error-card" role="alert">
          <p className="cs-error-message">Error loading cleaning records: {error}</p>
        </div>
      )}

      {!isLoading && !error && (
        <DataTable
          columns={currentColumns}
          data={currentData}
          loading={false}
          emptyTitle={activeTab === 'audit' ? 'No field modifications logged' : 'No rows rejected'}
          emptyDescription={
            activeTab === 'audit'
              ? 'All parsed fields already match target clean formats or no source data has been evaluated.'
              : 'All source rows satisfied mandatory field and syntax constraints without fatal anomalies.'
          }
          hasActiveFilters={hasActiveFilters}
          onClearFilters={onClearAllFilters}
          sort={sort}
          onSortChange={onSortChange}
          pagination={pagination}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
};
