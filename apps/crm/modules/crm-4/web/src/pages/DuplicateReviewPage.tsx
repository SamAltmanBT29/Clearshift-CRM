import React, { useState } from 'react';
import { DataTable } from '../components/DataTable.js';
import { FilterToolbar } from '../components/FilterToolbar.js';
import { DUPLICATES_COLUMNS } from '../../table/columns.js';
import { CRM4_DUPLICATES_FACETS } from '../../table/facets.js';
import type {
  TableSortState,
  TablePaginationState,
  TableFilterState,
  ActiveFilterPill,
  FilterFacet,
} from '../../table/types.js';

export interface DuplicateReviewPageProps {
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
  onResolveCandidate?: ((candidateId: string, decision: 'MERGE' | 'REJECT_DUPLICATE' | 'KEEP_SEPARATE', keptId: string, mergedId: string, reason: string) => Promise<void>) | undefined;
}

/**
 * Duplicate Candidate Review Page for CRM-4 Marketing Lists and Campaigns ([CRM4-12])
 * Enforces exact key matches and human-reviewed resolution (no fuzzy auto-merging).
 */
export const DuplicateReviewPage: React.FC<DuplicateReviewPageProps> = ({
  data = [],
  isLoading = false,
  isEmpty = false,
  error = null,
  onRetry,
  httpStatus,
  isAccessDenied = false,
  requiredCapability = 'module.write',
  requiredRole = 'editor',
  currentRole = 'editor',
  emptyActionLabel = 'Refresh Candidates',
  onEmptyAction,
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
  facets = CRM4_DUPLICATES_FACETS,
  hasActiveFilters = false,
  onResolveCandidate,
}) => {
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, unknown> | null>(null);
  const [decision, setDecision] = useState<'MERGE' | 'REJECT_DUPLICATE' | 'KEEP_SEPARATE'>('MERGE');
  const [reason, setReason] = useState<string>('');
  const [keptId, setKeptId] = useState<string>('');
  const [mergedId, setMergedId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayData = isEmpty ? [] : data;
  const isFiltersActive =
    hasActiveFilters ||
    Boolean(search.trim().length > 0) ||
    Object.values(filters).some((v) => v !== undefined && v.trim().length > 0) ||
    activePills.length > 0;

  const accessForbidden = isAccessDenied || httpStatus === 403;

  const handleOpenReview = (record: Record<string, unknown>) => {
    setSelectedCandidate(record);
    const rawIds = record['recordIds'];
    const ids = Array.isArray(rawIds) ? (rawIds as string[]) : [];
    if (ids.length >= 2) {
      setKeptId(ids[0] ?? '');
      setMergedId(ids[1] ?? '');
    }
    setReason('');
  };

  const handleResolve = async () => {
    if (!selectedCandidate || !onResolveCandidate) return;
    setIsSubmitting(true);
    try {
      await onResolveCandidate(
        String(selectedCandidate['id']),
        decision,
        keptId,
        mergedId,
        reason || 'Human reviewer resolved candidate'
      );
      setSelectedCandidate(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="cs-page-container" data-testid="duplicate-review-page">
      <div className="cs-page-header">
        <h2>Marketing Duplicate Candidate Review</h2>
        <p className="cs-page-desc">
          Deterministic exact matches held for authorized human review (BR-CRM4-DUP-01/02/03). Fuzzy auto-merges are strictly prohibited in V1.
        </p>
      </div>

      {accessForbidden ? (
        <div data-testid="access-denied-view" className="cs-access-denied">
          <h3>Access Denied</h3>
          <p>
            You lack the required capability (<code>{requiredCapability}</code>) or role (<code>{requiredRole}</code>). Current role: {currentRole}.
          </p>
        </div>
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
              searchPlaceholder="Search duplicates by normalized key or entity..."
            />
          )}

          {error && (
            <div className="cs-error-container" style={{ marginBottom: '16px' }} data-testid="error-alert">
              <p>Error loading duplicate candidates. {String(error)}</p>
              {onRetry && (
                <button type="button" onClick={onRetry}>
                  Retry
                </button>
              )}
            </div>
          )}

          <DataTable
            columns={DUPLICATES_COLUMNS}
            data={displayData}
            loading={isLoading}
            emptyTitle={isFiltersActive ? 'No matching candidates found' : 'No duplicate candidates'}
            emptyDescription={
              isFiltersActive
                ? 'No duplicate review candidates match your filters. Try clearing filter pills.'
                : 'All marketing entities are distinct. No duplicate candidates held for human review.'
            }
            sort={sort}
            onSortChange={onSortChange}
            pagination={pagination}
            onPageChange={onPageChange}
          />

          {selectedCandidate && (
            <div className="cs-modal-overlay" data-testid="duplicate-resolution-modal">
              <div className="cs-modal-content">
                <h3>Resolve Duplicate Candidate</h3>
                <p>
                  <strong>Candidate ID:</strong> {String(selectedCandidate['id'])}
                </p>
                <p>
                  <strong>Matched Key:</strong> {String(selectedCandidate['normalizedKey'])}
                </p>
                <p>
                  <strong>Entity:</strong> {String(selectedCandidate['entity'])}
                </p>

                <div className="cs-form-group">
                  <label htmlFor="decision-select">Decision:</label>
                  <select
                    id="decision-select"
                    value={decision}
                    onChange={(e) => setDecision(e.target.value as any)}
                  >
                    <option value="MERGE">MERGE (Combine records)</option>
                    <option value="REJECT_DUPLICATE">REJECT_DUPLICATE (Reject incoming record)</option>
                    <option value="KEEP_SEPARATE">KEEP_SEPARATE (False positive, keep distinct)</option>
                  </select>
                </div>

                {decision === 'MERGE' && (
                  <>
                    <div className="cs-form-group">
                      <label htmlFor="kept-id-input">Kept Entity ID (Primary):</label>
                      <input
                        id="kept-id-input"
                        type="text"
                        value={keptId}
                        onChange={(e) => setKeptId(e.target.value)}
                      />
                    </div>
                    <div className="cs-form-group">
                      <label htmlFor="merged-id-input">Merged Entity ID (Subsumed):</label>
                      <input
                        id="merged-id-input"
                        type="text"
                        value={mergedId}
                        onChange={(e) => setMergedId(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <div className="cs-form-group">
                  <label htmlFor="reason-input">Resolution Reason:</label>
                  <textarea
                    id="reason-input"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Provide audit rationale for this merge or separation decision..."
                  />
                </div>

                <div className="cs-modal-actions">
                  <button
                    type="button"
                    onClick={() => setSelectedCandidate(null)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="cs-btn-primary"
                    onClick={handleResolve}
                    disabled={isSubmitting || !reason.trim()}
                  >
                    {isSubmitting ? 'Resolving...' : 'Confirm Resolution'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
