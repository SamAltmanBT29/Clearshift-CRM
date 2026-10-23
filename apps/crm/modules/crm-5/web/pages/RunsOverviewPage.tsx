import React, { useState } from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { TableSkeleton } from '../components/TableSkeleton.js';
import { ErrorAlert } from '../components/ErrorAlert.js';
import { AccessDeniedView } from '../components/AccessDeniedView.js';
import { CreateRunModal } from '../components/CreateRunModal.js';
import { ConfirmationToast } from '../components/ConfirmationToast.js';
import type { CreateRunFormData } from '../components/CreateRunForm.js';
import { RUNS_COLUMNS } from '../table/columns.js';
import { CRM5_RUNS_FACETS } from '../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../table/types.js';

export interface RunsOverviewPageProps {
  data?: Record<string, unknown>[];
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
  onCreateRun?: (data: CreateRunFormData) => Promise<unknown>;
  onRunCreated?: (record: Record<string, unknown>) => void;
  isCreateModalOpen?: boolean;
  onOpenCreateModal?: () => void;
  onCloseCreateModal?: () => void;
}

/**
 * Migration Runs Overview Page Shell
 * Integrates with /api/v1/crm-control/runs, FilterToolbar, paginated DataTable,
 * and entity creation workflow with field-level validation and modal dialog.
 * Conforms to ClearShift V1 Issue #191 (CRM5-18), Issue #192 (CRM5-19), and Issue #193 (CRM5-20).
 */
export const RunsOverviewPage: React.FC<RunsOverviewPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'control:read',
  requiredRole,
  currentRole,
  emptyActionLabel,
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
  facets = CRM5_RUNS_FACETS,
  hasActiveFilters = false,
  onCreateRun,
  onRunCreated,
  isCreateModalOpen,
  onOpenCreateModal,
  onCloseCreateModal,
}) => {
  // Local state for modal & toast
  const [internalModalOpen, setInternalModalOpen] = useState<boolean>(false);
  const [localData, setLocalData] = useState<Record<string, unknown>[]>([]);
  const [toast, setToast] = useState<{
    show: boolean;
    title: string;
    message: string;
  } | null>(null);

  const modalOpen = isCreateModalOpen !== undefined ? isCreateModalOpen : internalModalOpen;

  const handleOpenModal = () => {
    if (onOpenCreateModal) {
      onOpenCreateModal();
    } else {
      setInternalModalOpen(true);
    }
  };

  const handleCloseModal = () => {
    if (onCloseCreateModal) {
      onCloseCreateModal();
    } else {
      setInternalModalOpen(false);
    }
  };

  const handleRunSubmit = async (formData: CreateRunFormData) => {
    if (onCreateRun) {
      return await onCreateRun(formData);
    }
    // Default simulated creation if no external handler provided
    const newRecord: Record<string, unknown> = {
      id: `sim-${Date.now()}`,
      batchId: formData.batchId,
      module: formData.module,
      step: formData.step,
      status: formData.status ?? 'pending',
      recordsIn: formData.recordsIn,
      recordsOut: formData.recordsOut,
      recordsRejected: formData.recordsRejected,
      startedAt: new Date().toISOString(),
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return newRecord;
  };

  const handleRunSuccess = (created: unknown) => {
    const record =
      typeof created === 'object' && created !== null
        ? (created as Record<string, unknown>)
        : {};
    const batchIdStr = String(record['batchId'] || 'unknown');

    // Update table cache
    setLocalData((prev) => [record, ...prev]);

    if (onRunCreated) {
      onRunCreated(record);
    }

    // Show Confirmation Toast
    setToast({
      show: true,
      title: 'Run Recorded',
      message: `Migration run projection for batch '${batchIdStr}' was successfully created.`,
    });
  };

  // Merge external and newly recorded local data
  const combinedData = [...localData, ...data];
  const displayData = isEmpty && localData.length === 0 ? [] : combinedData;

  const isFiltersActive =
    hasActiveFilters ||
    Boolean(search.trim().length > 0) ||
    Object.values(filters).some((v) => v !== undefined && v.trim().length > 0) ||
    activePills.length > 0;

  const accessForbidden = isAccessDenied || httpStatus === 403;

  return (
    <div className="cs-page-container">
      {/* Toast Notification Container */}
      {toast && (
        <div className="cs-toast-portal">
          <ConfirmationToast
            show={toast.show}
            title={toast.title}
            message={toast.message}
            type="success"
            onDismiss={() => setToast(null)}
          />
        </div>
      )}

      {/* Header Landmark with Action Button */}
      <div className="cs-page-header">
        <div className="cs-page-header-row">
          <div>
            <h2>Migration Run Projections</h2>
            <p className="cs-page-desc">
              Inspect batch execution events and progression through migration lifecycle steps.
            </p>
          </div>
          <button
            type="button"
            className="cs-btn cs-btn-primary cs-create-run-btn"
            onClick={handleOpenModal}
          >
            + Record Migration Run
          </button>
        </div>
      </div>

      {accessForbidden ? (
        <AccessDeniedView
          requiredCapability={requiredCapability}
          requiredRole={requiredRole}
          currentRole={currentRole}
          resourceName="Migration Run Projections"
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
              searchPlaceholder="Search runs by batch ID..."
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
              columnCount={RUNS_COLUMNS.length}
              ariaLabel="Loading migration runs from server..."
            />
          ) : !error && (
            <DataTable
              columns={RUNS_COLUMNS}
              data={displayData}
              loading={false}
              emptyTitle={isFiltersActive ? 'No matching records found' : 'No records found'}
              emptyDescription={
                isFiltersActive
                  ? 'No migration run projections match your search and filter criteria. Try adjusting your query or resetting filters.'
                  : 'No migration run projections currently recorded. Run events will project here automatically.'
              }
              emptyActionLabel={emptyActionLabel ?? '+ Record Migration Run'}
              onEmptyAction={onEmptyAction ?? handleOpenModal}
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

      {/* Entity Creation Modal Dialog */}
      <CreateRunModal
        isOpen={modalOpen}
        onClose={handleCloseModal}
        onSubmit={handleRunSubmit}
        onSuccess={handleRunSuccess}
      />
    </div>
  );
};
