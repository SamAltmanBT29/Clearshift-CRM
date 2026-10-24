import type { TableFilterState, ActiveFilterPill, FilterFacet } from './types.js';

export const SEARCH_DEBOUNCE_MS = 300;

export interface SearchFilterControllerOptions {
  initialSearch?: string;
  initialFilters?: TableFilterState;
  debounceMs?: number;
  onSearchChange?: (term: string) => void;
  onFilterChange?: (filters: TableFilterState) => void;
  onQueryChange?: (params: Record<string, string>) => void;
}

/**
 * Controller for managing debounced search (300ms), faceted filter dimensions,
 * active filter pill tags, and bidirectional URL query synchronization.
 * Fully compliant with ClearShift V1 SDS (Issue #171 / CRM4-18).
 */
export class SearchFilterController {
  private search: string = '';
  private filters: TableFilterState = {};
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  private onSearchChange?: ((term: string) => void) | undefined;
  private onFilterChange?: ((filters: TableFilterState) => void) | undefined;
  private onQueryChange?: ((params: Record<string, string>) => void) | undefined;

  constructor(options?: SearchFilterControllerOptions) {
    this.search = options?.initialSearch ?? options?.initialFilters?.search ?? '';
    this.debounceMs = options?.debounceMs ?? SEARCH_DEBOUNCE_MS;
    this.onSearchChange = options?.onSearchChange;
    this.onFilterChange = options?.onFilterChange;
    this.onQueryChange = options?.onQueryChange;

    if (options?.initialFilters) {
      this.filters = { ...options.initialFilters };
      delete this.filters.search;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Debounced Search State
  // ---------------------------------------------------------------------------

  public getSearch(): string {
    return this.search;
  }

  /**
   * Sets search text with deterministic 300ms debounce.
   * If `immediate` is true, cancels timer and triggers callbacks synchronously.
   */
  public setSearch(term: string, immediate: boolean = false): void {
    this.search = term;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (immediate) {
      this.emitSearchChange();
    } else {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.emitSearchChange();
      }, this.debounceMs);
    }
  }

  /**
   * Immediately flushes any pending debounced search.
   */
  public flushSearch(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.emitSearchChange();
    }
  }

  /**
   * Cancels pending search debounce timer without triggering execution.
   */
  public cancelSearch(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Clears search immediately and notifies listeners.
   */
  public clearSearch(): void {
    this.setSearch('', true);
  }

  private emitSearchChange(): void {
    if (this.onSearchChange) {
      this.onSearchChange(this.search);
    }
    this.emitQueryChange();
  }

  // ---------------------------------------------------------------------------
  // 2. Faceted Filter Dimensions
  // ---------------------------------------------------------------------------

  public getFilters(): TableFilterState {
    return { ...this.filters };
  }

  public getFilter(key: string): string | undefined {
    return this.filters[key];
  }

  /**
   * Sets or clears a faceted filter value.
   */
  public setFilter(key: string, value: string | undefined): void {
    if (key === 'search') {
      this.setSearch(value ?? '', true);
      return;
    }

    if (value === undefined || value.trim() === '') {
      delete this.filters[key];
    } else {
      this.filters[key] = value.trim();
    }

    this.emitFilterChange();
  }

  public setFilters(newFilters: TableFilterState): void {
    const { search, ...rest } = newFilters;
    this.filters = { ...rest };
    if (search !== undefined) {
      this.setSearch(search, true);
    } else {
      this.emitFilterChange();
    }
  }

  /**
   * Removes a specific filter key (or clears search if key is 'search').
   */
  public removeFilter(key: string): void {
    if (key === 'search') {
      this.clearSearch();
      return;
    }
    delete this.filters[key];
    this.emitFilterChange();
  }

  /**
   * Resets all search input and filter facets at once ('Clear All' action).
   */
  public clearAll(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.search = '';
    this.filters = {};
    if (this.onSearchChange) {
      this.onSearchChange('');
    }
    this.emitFilterChange();
  }

  public hasActiveFilters(): boolean {
    const hasSearch = this.search.trim().length > 0;
    const hasFacet = Object.values(this.filters).some(
      (v) => v !== undefined && v.trim().length > 0
    );
    return hasSearch || hasFacet;
  }

  private emitFilterChange(): void {
    if (this.onFilterChange) {
      this.onFilterChange(this.getFilters());
    }
    this.emitQueryChange();
  }

  private emitQueryChange(): void {
    if (this.onQueryChange) {
      this.onQueryChange(this.toQueryParams());
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Active Filter Pill Tags
  // ---------------------------------------------------------------------------

  /**
   * Returns active filter tags suitable for pill chip rendering.
   */
  public getActiveFilterPills(facets?: FilterFacet[]): ActiveFilterPill[] {
    const pills: ActiveFilterPill[] = [];

    if (this.search.trim().length > 0) {
      pills.push({
        key: 'search',
        label: 'Search',
        value: this.search,
        displayValue: `"${this.search}"`,
      });
    }

    const facetLabelMap = new Map<string, string>();
    const optionLabelMap = new Map<string, Map<string, string>>();

    if (facets) {
      for (const facet of facets) {
        facetLabelMap.set(facet.paramKey, facet.label);
        const optMap = new Map<string, string>();
        for (const opt of facet.options) {
          if (opt.value) {
            optMap.set(opt.value, opt.label);
          }
        }
        optionLabelMap.set(facet.paramKey, optMap);
      }
    }

    for (const [key, value] of Object.entries(this.filters)) {
      if (value && value.trim().length > 0) {
        const label =
          facetLabelMap.get(key) ??
          key.charAt(0).toUpperCase() + key.slice(1);
        const displayValue = optionLabelMap.get(key)?.get(value) ?? value;

        pills.push({
          key,
          label,
          value,
          displayValue,
        });
      }
    }

    return pills;
  }

  // ---------------------------------------------------------------------------
  // 4. URL Query State Serialization & Deserialization
  // ---------------------------------------------------------------------------

  public toQueryParams(): Record<string, string> {
    const params: Record<string, string> = {};

    if (this.search.trim().length > 0) {
      params['search'] = this.search.trim();
    }

    for (const [key, value] of Object.entries(this.filters)) {
      if (value && value.trim().length > 0) {
        params[key] = value.trim();
      }
    }

    return params;
  }

  public toQueryString(): string {
    const params = this.toQueryParams();
    const query = new URLSearchParams(params).toString();
    return query ? `?${query}` : '';
  }

  public fromQueryParams(
    params: Record<string, string> | URLSearchParams
  ): void {
    const entries: Record<string, string> =
      params instanceof URLSearchParams
        ? Object.fromEntries(params.entries())
        : params;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.search = entries['search'] ?? '';
    const newFilters: TableFilterState = {};

    for (const [key, value] of Object.entries(entries)) {
      if (
        key !== 'search' &&
        key !== 'page' &&
        key !== 'pageSize' &&
        key !== 'limit' &&
        key !== 'sort' &&
        key !== 'order' &&
        value &&
        value.trim().length > 0
      ) {
        newFilters[key] = value.trim();
      }
    }

    this.filters = newFilters;
    this.emitFilterChange();
  }

  private escapeAttr(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ---------------------------------------------------------------------------
  // 5. Accessible WAI-ARIA HTML Renderer
  // ---------------------------------------------------------------------------

  public renderHtml(facets?: FilterFacet[]): string {
    const pills = this.getActiveFilterPills(facets);

    // Active pills HTML
    const pillsHtml =
      pills.length > 0
        ? `
<div class="cs-active-filter-pills" role="region" aria-label="Active filters">
  <span class="cs-filter-pills-label">Active filters:</span>
  <div class="cs-filter-pills-list">
    ${pills
      .map(
        (pill) => `
    <span class="cs-filter-pill" data-key="${pill.key}">
      <span class="cs-filter-pill-text"><span class="cs-filter-pill-label">${this.escapeAttr(pill.label)}:</span> ${this.escapeAttr(pill.displayValue)}</span>
      <button type="button" class="cs-filter-pill-remove" data-action="remove-filter" data-key="${pill.key}" aria-label="Remove filter: ${this.escapeAttr(pill.label)} ${this.escapeAttr(pill.displayValue)}">×</button>
    </span>`
      )
      .join('')}
    <button type="button" class="cs-clear-all-filters-btn" data-action="clear-all">Clear All</button>
  </div>
</div>`
        : '';

    // Search bar HTML
    const searchHtml = `
<div class="cs-search-bar" role="search">
  <label for="cs-search-input" class="cs-sr-only">Search records</label>
  <div class="cs-search-input-wrapper">
    <span class="cs-search-icon" aria-hidden="true">🔍</span>
    <input
      type="search"
      id="cs-search-input"
      class="cs-search-input"
      placeholder="Search by name, audience, or key..."
      value="${this.escapeAttr(this.search)}"
      aria-label="Search records"
    />
    ${
      this.search
        ? '<button type="button" class="cs-search-clear-btn" data-action="clear-search" aria-label="Clear search">×</button>'
        : ''
    }
  </div>
</div>`;

    // Facet selects HTML
    const facetsHtml = (facets ?? [])
      .map((facet) => {
        const currentVal = this.filters[facet.paramKey] ?? '';
        const optionsHtml = facet.options
          .map(
            (opt) =>
              `<option value="${opt.value}"${opt.value === currentVal ? ' selected' : ''}>${opt.label}</option>`
          )
          .join('');

        return `
<div class="cs-filter-facet">
  <label for="facet-${facet.id}" class="cs-facet-label">${facet.label}</label>
  <select id="facet-${facet.id}" class="cs-facet-select" data-facet="${facet.paramKey}">
    ${optionsHtml}
  </select>
</div>`;
      })
      .join('');

    return `
<div class="cs-filter-toolbar">
  <div class="cs-filter-toolbar-top">
    ${searchHtml}
    <div class="cs-facet-group">
      ${facetsHtml}
    </div>
  </div>
  ${pillsHtml}
</div>`;
  }
}
