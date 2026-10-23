import React, { useState } from 'react';
import type { MigrationReject } from '@clearshift/contracts';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { RejectDetailModal } from '../components/RejectDetailModal.js';
import { REJECTS_AUDIT_COLUMNS } from '../table/columns.js';
import { CRM5_REJECTS_FACETS } from '../table/facets.js';
import {
  enhanceRejectRecord,
  generateFormulaSafeRejectsCsv,
  downloadRejectsCsv,
} from '../utils/reject-helpers.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface RejectsOverviewPageProps {
  data?: (MigrationReject | Record<string, unknown>)[];
  payloadMap?: Record<string, Record<string, unknown>>;
  isLoading?: boolean;
  isEmpty?: boolean;
  error?: string | Error | { code?: string; message?: string; details?: unknown } | null;
  onRetry?: (() => void) | undefined;
  httpStatus?: number;
  isAccessDenied?: boolean;
  requiredCapability?: string;
  requiredRole?: string;
  currentRole?: string;
  emptyActionLabel?: string;
  onEmptyAction?: (() => void) | undefined;
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
  onInspectReject?: ((reject: MigrationReject) => void) | undefined;
  onExportCsv?: (() => void) | undefined;
  onNavigateBatch?: ((batchId: string) => void) | undefined;
}

/**
 * Rejections Overview Page Shell
 * Integrates with /api/v1/crm-control/rejects, FilterToolbar, paginated DataTable,
 * RejectDetailModal, and formula-safe CSV export.
 * Conforms to ClearShift V1 Issue #196 (CRM5-23), Issue #192 (CRM5-19), and Issue #191 (CRM5-18).
 */
export const RejectsOverviewPage: React.FC<RejectsOverviewPageProps> = ({
  data = [],
  payloadMap = {},
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'control:read',
  requiredRole,
  currentRole,
  emptyActionLabel = 'Refresh Rejections',
  onEmptyAction,
  sort,
  onSortChange,
  pagination = { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  onPageChange,
  search = '',
  onSearchChange,
  filters = {},
  onFilterChange,
  onRemoveFilter,
  onClearAllFilters,
  activePills = [],
  facets = CRM5_REJECTS_FACETS,
  hasActiveFilters = false,
  onInspectReject,
  onExportCsv,
  onNavigateBatch,
}) => {
  const [selectedReject, setSelectedReject] = useState<MigrationReject | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const accessForbidden = isAccessDenied || httpStatus === 403;
  const displayData = isEmpty ? [] : data;

  const isFiltersActive =
    hasActiveFilters ||
    Boolean(search.trim().length > 0) ||
    Object.values(filters).some((v) => v !== undefined && v.trim().length > 0) ||
    activePills.length > 0;

  const handleInspect = (reject: MigrationReject) => {
    setSelectedReject(reject);
    setIsModalOpen(true);
    onInspectReject?.(reject);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedReject(null);
  };

  const handleExport = () => {
    if (onExportCsv) {
      onExportCsv();
      return;
    }
    const safeCsv = generateFormulaSafeRejectsCsv(displayData as MigrationReject[], payloadMap);
    downloadRejectsCsv(safeCsv, 'crm-rejections-export.csv');
  };

  // Enhance each reject row for tabular display
  const tableRows = displayData.map((item, idx) => {
    const rawReject = item as MigrationReject;
    const rawPayload = payloadMap ? payloadMap[rawReject.id] : undefined;
    const enhanced = enhanceRejectRecord(rawReject, rawPayload);

    return {
      ...item,
      id: rawReject.id || `reject-row-${idx}`,
      rowIndex: rawReject.rowIndex,
      module: (
        <span className={`cs-badge cs-badge-module cs-badge-${rawReject.module}`}>
          {rawReject.module}
        </span>
      ),
      batchId: rawReject.batchId,
      contextIdentifier: (
        <div className="cs-context-identifier-cell">
          <span className="cs-context-identifier-label">{enhanced.identifierLabel}:</span>{' '}
          <span className="cs-context-identifier-value">{enhanced.identifierValue}</span>
        </div>
      ),
      errorCode: (
        <span className="cs-error-code-badge" title={enhanced.category}>
          {rawReject.errorCode}
        </span>
      ),
      errorMessage: (
        <div className="cs-reason-text-cell" title={enhanced.remediation}>
          {enhanced.explanation}
        </div>
      ),
      rawPayloadHash: (
        <code className="cs-hash-code">
          {rawReject.rawPayloadHash ? rawReject.rawPayloadHash.substring(0, 10) + '…' : '—'}
        </code>
      ),
      createdAt:
        rawReject.createdAt instanceof Date
          ? rawReject.createdAt.toLocaleDateString()
          : String(rawReject.createdAt || '—'),
      actions: (
        <button
          type="button"
          className="cs-inspect-btn"
          onClick={() => handleInspect(rawReject)}
          aria-label={`Inspect rejected row ${rawReject.rowIndex}`}
        >
          Inspect
        </button>
      ),
      _raw: rawReject,
    };
  });

  return (
    <div className="cs-page-container">
      <div className="cs-page-header-row">
        <div className="cs-page-header">
          <h2>Row-Level Rejection Audit</h2>
          <p className="cs-page-desc">
            Failed row inspections with module-specific context identifiers, failure reasons, and formula-safe CSV export.
          </p>
        </div>
        <div className="cs-page-actions">
          <button
            type="button"
            className="cs-btn cs-btn-export"
            onClick={handleExport}
            disabled={isLoading || displayData.length === 0}
            aria-label="Export filtered rejected rows as formula-safe CSV"
          >
            📥 Export Safe CSV
          </button>
        </div>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Row-Level Rejection Audit"
        />
      ) : (
        <>
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
              searchPlaceholder="Search rejections by batch ID or error code..."
            />
          )}

          {error && (
            <div className="cs-error-container" style={{ marginBottom: '16px' }}>
              <ErrorAlert error={error} onRetry={onRetry} />
            </div>
          )}

          {isLoading ? (
            <TableSkeleton
              rowCount={5}
              columnCount={REJECTS_AUDIT_COLUMNS.length}
              ariaLabel="Loading rejection records..."
            />
          ) : !error && (
            <DataTable
              columns={REJECTS_AUDIT_COLUMNS}
              data={tableRows}
              loading={false}
              emptyTitle={isFiltersActive ? 'No matching rejections found' : 'No rejected rows detected'}
              emptyDescription={
                isFiltersActive
                  ? 'No rejected rows match your current search and filter criteria. Try adjusting your query or resetting filters.'
                  : 'No rejected rows detected. All migration batch rows passed validation cleanly.'
              }
              emptyActionLabel={emptyActionLabel}
              onEmptyAction={onEmptyAction}
              hasActiveFilters={isFiltersActive}
              onClearFilters={onClearAllFilters}
              sort={sort}
              onSortChange={onSortChange}
              pagination={pagination}
              onPageChange={onPageChange}
            />
          )}
        </>
      )}

      {/* Rejection Detail Inspection Modal */}
      <RejectDetailModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        reject={selectedReject}
        rawPayload={selectedReject && payloadMap ? payloadMap[selectedReject.id] : undefined}
        onNavigateBatch={onNavigateBatch}
      />
    </div>
  );
};
