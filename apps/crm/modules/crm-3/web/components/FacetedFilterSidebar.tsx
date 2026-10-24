import React from 'react';
import type { FilterFacet, TableFilterState } from '../table/types.js';

export interface FacetedFilterSidebarProps {
  facets: FilterFacet[];
  filters: TableFilterState;
  onFilterChange: (key: string, value: string) => void;
  onClearAll?: () => void;
  hasActiveFilters?: boolean;
  className?: string;
}

/**
 * Faceted Filter Sidebar for CRM-3 Support Tickets.
 * Conforms to ClearShift V1 Issue #151 (CRM3-18).
 */
export const FacetedFilterSidebar: React.FC<FacetedFilterSidebarProps> = ({
  facets,
  filters,
  onFilterChange,
  onClearAll,
  hasActiveFilters = false,
  className = '',
}) => {
  return (
    <aside
      className={`cs-filter-sidebar ${className}`.trim()}
      aria-label="Faceted Filters"
    >
      <div className="cs-sidebar-header">
        <h3 className="cs-sidebar-title">Filters</h3>
        {hasActiveFilters && onClearAll && (
          <button
            type="button"
            className="cs-sidebar-reset-btn"
            onClick={onClearAll}
            aria-label="Reset all filters"
          >
            Reset
          </button>
        )}
      </div>

      <div className="cs-sidebar-facets">
        {facets.map((facet) => {
          const currentValue = filters[facet.paramKey] ?? '';

          return (
            <div key={facet.id} className="cs-sidebar-facet">
              <label
                htmlFor={`sidebar-facet-${facet.id}`}
                className="cs-facet-label"
              >
                {facet.label}
              </label>
              <select
                id={`sidebar-facet-${facet.id}`}
                className="cs-facet-select"
                value={currentValue}
                onChange={(e) => onFilterChange(facet.paramKey, e.target.value)}
                data-facet={facet.paramKey}
              >
                {facet.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </aside>
  );
};
