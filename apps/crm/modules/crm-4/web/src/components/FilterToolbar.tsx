import React from 'react';
import { SearchInput } from './SearchInput.js';
import { ActiveFilterPills } from './ActiveFilterPills.js';
import type { FilterFacet, TableFilterState, ActiveFilterPill } from '../../table/types.js';

export interface FilterToolbarProps {
  search?: string;
  onSearchChange: (value: string) => void;
  facets?: FilterFacet[];
  filters: TableFilterState;
  onFilterChange: (key: string, value: string) => void;
  activePills: ActiveFilterPill[];
  onRemoveFilter: (key: string) => void;
  onClearAll: () => void;
  searchPlaceholder?: string;
  className?: string;
}

/**
 * Composite Filter Toolbar combining SearchInput, quick facet selectors,
 * and ActiveFilterPills.
 * Conforms to ClearShift V1 Issue #171 (CRM4-18).
 */
export const FilterToolbar: React.FC<FilterToolbarProps> = ({
  search = '',
  onSearchChange,
  facets = [],
  filters,
  onFilterChange,
  activePills,
  onRemoveFilter,
  onClearAll,
  searchPlaceholder = 'Search by name, audience, or key...',
  className = '',
}) => {
  return (
    <div className={`cs-filter-toolbar ${className}`.trim()}>
      <div className="cs-filter-toolbar-top">
        <SearchInput
          value={search}
          placeholder={searchPlaceholder}
          onChange={onSearchChange}
        />
        {facets.length > 0 && (
          <div className="cs-facet-group">
            {facets.map((facet) => {
              const currentVal = filters[facet.paramKey] ?? '';
              return (
                <div key={facet.id} className="cs-filter-facet">
                  <label
                    htmlFor={`toolbar-facet-${facet.id}`}
                    className="cs-facet-label"
                  >
                    {facet.label}
                  </label>
                  <select
                    id={`toolbar-facet-${facet.id}`}
                    className="cs-facet-select"
                    value={currentVal}
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
        )}
      </div>

      <ActiveFilterPills
        pills={activePills}
        onRemoveFilter={onRemoveFilter}
        onClearAll={onClearAll}
      />
    </div>
  );
};
