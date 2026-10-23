import React from 'react';
import type { MigrationRun } from '@clearshift/contracts';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, Badge } from '@cs/ui';
import type { TableSortState } from '../../table/types.js';

export interface RunsTableProps {
  runs: MigrationRun[];
  sort?: TableSortState | undefined;
  onSortChange?: ((columnKey: string) => void) | undefined;
  onRowClick?: ((run: MigrationRun) => void) | undefined;
  className?: string;
  ariaLabel?: string;
}

interface ColumnDef {
  key: string;
  header: string;
  sortable: boolean;
  align: 'left' | 'right' | 'center';
  width?: string;
}

const RUN_COLUMNS: ColumnDef[] = [
  { key: 'batchId', header: 'Batch ID', sortable: true, align: 'left', width: '200px' },
  { key: 'module', header: 'Module', sortable: true, align: 'left', width: '120px' },
  { key: 'step', header: 'Step', sortable: true, align: 'left', width: '120px' },
  { key: 'status', header: 'Status', sortable: true, align: 'left', width: '130px' },
  { key: 'recordsIn', header: 'Records In', sortable: true, align: 'right', width: '130px' },
  { key: 'recordsOut', header: 'Records Out', sortable: true, align: 'right', width: '130px' },
  { key: 'recordsRejected', header: 'Rejected', sortable: true, align: 'right', width: '120px' },
  { key: 'startedAt', header: 'Started At', sortable: true, align: 'left', width: '180px' },
  { key: 'completedAt', header: 'Completed At', sortable: false, align: 'left', width: '180px' },
];

/**
 * Maps run status to corresponding @cs/ui Badge variant.
 */
function getStatusBadgeVariant(
  status: string
): 'success' | 'info' | 'neutral' | 'danger' | 'warning' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'running':
      return 'info';
    case 'failed':
      return 'danger';
    case 'halted':
      return 'warning';
    case 'pending':
    default:
      return 'neutral';
  }
}

/**
 * Text-safe date formatter that neutralizes potential formula injection
 * and formats ISO dates to readable timestamps.
 */
function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return '—';
  }
}

/**
 * Sanitizes cell text to ensure spreadsheet formula injection prefixes
 * (=, +, -, @, \t, \r) cannot trigger arbitrary evaluation.
 */
function sanitizeCellText(val: unknown): string {
  if (val == null) return '';
  const str = String(val);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/**
 * RunsTable component rendering SDS-required columns for CRM-5 migration run projections.
 * Fully keyboard accessible, text-safe, and integrates with @cs/ui primitives.
 */
export const RunsTable: React.FC<RunsTableProps> = ({
  runs,
  sort,
  onSortChange,
  onRowClick,
  className = '',
  ariaLabel = 'Migration Runs Projections Table',
}) => {
  return (
    <div
      className={`cs-runs-table-container ${className}`.trim()}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <Table className="cs-runs-table min-w-full">
        <TableHeader>
          <TableRow>
            {RUN_COLUMNS.map((col) => {
              const isSorted = sort?.columnKey === col.key;
              const direction = isSorted ? sort.direction : undefined;
              const ariaSort = isSorted
                ? direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none';

              return (
                <TableHead
                  key={col.key}
                  aria-sort={col.sortable ? ariaSort : undefined}
                  style={col.width ? { width: col.width } : undefined}
                  className={`text-${col.align}`}
                >
                  {col.sortable && onSortChange ? (
                    <button
                      type="button"
                      className="group inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded px-1 -ml-1 transition-colors"
                      onClick={() => onSortChange(col.key)}
                      aria-label={`Sort by ${col.header} ${isSorted && direction === 'asc' ? 'descending' : 'ascending'}`}
                    >
                      <span>{col.header}</span>
                      <span
                        className="text-xs text-slate-400 group-hover:text-slate-600"
                        aria-hidden="true"
                      >
                        {isSorted ? (direction === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    </button>
                  ) : (
                    <span>{col.header}</span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>

        <TableBody>
          {runs.map((run, idx) => {
            const hasRejections = run.recordsRejected > 0;
            const isClickable = Boolean(onRowClick);

            return (
              <TableRow
                key={run.id || `${run.batchId}-${run.step}-${idx}`}
                className={isClickable ? 'cursor-pointer hover:bg-slate-50 focus-within:bg-indigo-50/40' : ''}
                onClick={isClickable ? () => onRowClick!(run) : undefined}
                tabIndex={isClickable ? 0 : undefined}
                onKeyDown={
                  isClickable
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick!(run);
                        }
                      }
                    : undefined
                }
              >
                {/* Batch ID */}
                <TableCell className="font-mono text-xs font-medium text-slate-900">
                  <span className="cs-batch-id-cell select-all" title={run.batchId}>
                    {sanitizeCellText(run.batchId)}
                  </span>
                </TableCell>

                {/* Module */}
                <TableCell>
                  <Badge variant="stage" size="sm">
                    {sanitizeCellText(run.module)}
                  </Badge>
                </TableCell>

                {/* Step */}
                <TableCell className="text-slate-700 capitalize font-medium text-xs">
                  {sanitizeCellText(run.step)}
                </TableCell>

                {/* Status */}
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(run.status)} size="sm">
                    {run.status}
                  </Badge>
                </TableCell>

                {/* Records In */}
                <TableCell className="text-right font-mono text-xs text-slate-700">
                  {run.recordsIn.toLocaleString()}
                </TableCell>

                {/* Records Out */}
                <TableCell className="text-right font-mono text-xs text-slate-700">
                  {run.recordsOut.toLocaleString()}
                </TableCell>

                {/* Rejected */}
                <TableCell className="text-right font-mono text-xs">
                  {hasRejections ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-rose-700 bg-rose-50 font-semibold border border-rose-200">
                      {run.recordsRejected.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </TableCell>

                {/* Started At */}
                <TableCell className="text-slate-600 text-xs font-mono">
                  {formatDate(run.startedAt)}
                </TableCell>

                {/* Completed At */}
                <TableCell className="text-slate-600 text-xs font-mono">
                  {formatDate(run.completedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};
