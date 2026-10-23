import React from 'react';
import { Select } from '@cs/ui';
import { SearchInput } from './SearchInput.js';
import { ActiveFilterPills } from './ActiveFilterPills.js';
import type { FilterFacet, TableFilterState, ActiveFilterPill } from '../table/types.js';

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
 * Conforms to ClearShift V1 Issue #111 (CRM1-18).
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
  searchPlaceholder = 'Search by name, email, or key...',
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
                  <Select
                    id={`toolbar-facet-${facet.id}`}
                    className="cs-facet-select"
                    label={facet.label}
                    options={facet.options.map(({ value, label }) => ({ value, label }))}
                    value={currentVal}
                    onChange={(e) => onFilterChange(facet.paramKey, e.target.value)}
                    data-facet={facet.paramKey}
                  />
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
