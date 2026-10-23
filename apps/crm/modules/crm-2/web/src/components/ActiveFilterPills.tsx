import React from 'react';
import type { ActiveFilterPill } from '../table/types.js';

export interface ActiveFilterPillsProps {
  pills: ActiveFilterPill[];
  onRemoveFilter: (key: string) => void;
  onClearAll: () => void;
  className?: string;
}

/**
 * Active filter pill tags with individual removal and 'Clear All' reset.
 * Conforms to ClearShift V1 Issue #131 (CRM2-18).
 */
export const ActiveFilterPills: React.FC<ActiveFilterPillsProps> = ({
  pills,
  onRemoveFilter,
  onClearAll,
  className = '',
}) => {
  if (pills.length === 0) {
    return null;
  }

  return (
    <div
      className={`cs-active-filter-pills ${className}`.trim()}
      role="region"
      aria-label="Active filters"
    >
      <span className="cs-filter-pills-label">Active filters:</span>
      <div className="cs-filter-pills-list">
        {pills.map((pill) => (
          <span
            key={pill.key}
            className="cs-filter-pill"
            data-key={pill.key}
          >
            <span className="cs-filter-pill-text">
              <span className="cs-filter-pill-label">{pill.label}:</span>{' '}
              {pill.displayValue}
            </span>
            <button
              type="button"
              className="cs-filter-pill-remove"
              onClick={() => onRemoveFilter(pill.key)}
              aria-label={`Remove filter: ${pill.label} ${pill.displayValue}`}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="cs-clear-all-filters-btn"
          onClick={onClearAll}
          aria-label="Clear all active filters"
        >
          Clear All
        </button>
      </div>
    </div>
  );
};
