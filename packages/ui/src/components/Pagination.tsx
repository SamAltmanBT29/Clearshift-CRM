import React from 'react';
import { Button } from './Button.js';

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  className?: string;
}

export function Pagination({
  currentPage,
  totalPages,
  totalCount,
  pageSize,
  onPageChange,
  className = '',
}: PaginationProps) {
  const fromRecord = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toRecord = Math.min(currentPage * pageSize, totalCount);

  return (
    <nav
      role="navigation"
      aria-label="Pagination"
      className={`flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-2 border-t border-slate-200 text-sm text-slate-600 ${className}`}
    >
      <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
        <span>
          Showing <strong className="text-slate-900 font-semibold">{fromRecord}</strong> to{' '}
          <strong className="text-slate-900 font-semibold">{toRecord}</strong> of{' '}
          <strong className="text-slate-900 font-semibold">{totalCount}</strong> results
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Go to previous page"
        >
          Previous
        </Button>

        <span className="text-xs text-slate-700 font-medium px-2" aria-current="page">
          Page {currentPage} of {Math.max(1, totalPages)}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={currentPage >= totalPages || totalPages === 0}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Go to next page"
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
