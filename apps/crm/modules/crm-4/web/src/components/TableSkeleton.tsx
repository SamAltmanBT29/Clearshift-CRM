import React from 'react';

export interface TableSkeletonProps {
  rowCount?: number | undefined;
  columnCount?: number | undefined;
  ariaLabel?: string | undefined;
  className?: string | undefined;
  columnWidths?: (string | number)[] | undefined;
  role?: string | undefined;
  'aria-label'?: string | undefined;
  'aria-busy'?: boolean | 'true' | 'false' | undefined;
}

/**
 * Animated Table Skeleton Loader Component
 * Conforms to ClearShift V1 Issue #172 (CRM4-19).
 * Displays accessible table-structured shimmer placeholders during initial data fetching.
 * Serves as the companion loading state alongside EmptyState for zero-record states.
 */
export const TableSkeleton: React.FC<TableSkeletonProps> = ({
  rowCount = 5,
  columnCount = 6,
  ariaLabel,
  className = '',
  columnWidths,
  role = 'status',
  'aria-label': ariaLabelProp,
  'aria-busy': ariaBusyProp = 'true',
}) => {
  const effectiveLabel = ariaLabelProp ?? ariaLabel ?? 'Loading table data';
  const effectiveAriaBusy: 'true' | 'false' =
    ariaBusyProp === false || ariaBusyProp === 'false' ? 'false' : 'true';
  const rows = Array.from({ length: Math.max(1, rowCount) }, (_, i) => i);
  const cols = Array.from({ length: Math.max(1, columnCount) }, (_, i) => i);

  return (
    <div
      className={`cs-table-card cs-skeleton-card ${className}`.trim()}
      aria-busy={effectiveAriaBusy}
      aria-label={effectiveLabel}
      role={role}
    >
      <span className="cs-sr-only">{effectiveLabel}</span>
      <div className="cs-table-responsive">
        <table className="cs-table cs-skeleton-table" role="table">
          <thead className="cs-thead">
            <tr className="cs-tr">
              {cols.map((colIndex) => {
                const customWidth = columnWidths?.[colIndex];
                return (
                  <th
                    key={`th-skel-${colIndex}`}
                    className="cs-th"
                    scope="col"
                    style={customWidth ? { width: customWidth } : undefined}
                  >
                    <div
                      className="cs-skeleton-line cs-skeleton-header-cell"
                      style={{ width: `${Math.floor(60 + (colIndex % 3) * 15)}%` }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="cs-tbody">
            {rows.map((rowIndex) => (
              <tr key={`tr-skel-${rowIndex}`} className="cs-tr cs-skeleton-row">
                {cols.map((colIndex) => {
                  const variance = ((rowIndex + colIndex) % 4) * 10;
                  const cellWidth = Math.min(95, Math.max(45, 75 - variance));
                  return (
                    <td key={`td-skel-${rowIndex}-${colIndex}`} className="cs-td">
                      <div
                        className="cs-skeleton-line cs-skeleton-cell"
                        style={{ width: `${cellWidth}%` }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
