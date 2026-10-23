import {
  CRM2_ROUTES,
  getAllCrm2Routes,
  formatBrowserTitle,
  MODULE_TITLE,
} from '../routes.js';
import type { Crm2RouteDefinition, BreadcrumbItem } from '../types.js';

export interface Crm2ShellOptions {
  activeTabKey: string;
  onTabSelect?: ((tabKey: string) => void) | undefined;
  breadcrumbs?: BreadcrumbItem[] | undefined;
}

/**
 * CRM-2 Layout Shell and Navigation Controller
 * Manages WAI-ARIA tab navigation, keyboard events (ArrowLeft, ArrowRight, Home, End),
 * breadcrumb generation, and dynamic document title synchronization.
 */
export class Crm2ShellController {
  private activeTabKey: string;
  private onTabSelect?: ((tabKey: string) => void) | undefined;
  private customBreadcrumbs?: BreadcrumbItem[] | undefined;

  constructor(options: Crm2ShellOptions) {
    this.activeTabKey = options.activeTabKey;
    this.onTabSelect = options.onTabSelect;
    this.customBreadcrumbs = options.breadcrumbs;
    this.syncDocumentTitle();
  }

  public getActiveRoute(): Crm2RouteDefinition {
    return CRM2_ROUTES[this.activeTabKey] ?? getAllCrm2Routes()[0]!;
  }

  public getBreadcrumbs(): BreadcrumbItem[] {
    return this.customBreadcrumbs ?? this.getActiveRoute().breadcrumbs;
  }

  public setBreadcrumbs(breadcrumbs: BreadcrumbItem[] | undefined): void {
    this.customBreadcrumbs = breadcrumbs;
  }

  public selectTab(tabKey: string): void {
    this.activeTabKey = tabKey;
    this.syncDocumentTitle();
    if (this.onTabSelect) {
      this.onTabSelect(tabKey);
    }
  }

  public syncDocumentTitle(): void {
    if (typeof globalThis !== 'undefined' && 'document' in (globalThis as object)) {
      const doc = (globalThis as unknown as { document?: { title?: string } }).document;
      if (doc) {
        const route = this.getActiveRoute();
        doc.title = formatBrowserTitle(route.title);
      }
    }
  }

  public handleKeyNavigation(
    key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End',
    currentIndex: number
  ): number {
    const routes = getAllCrm2Routes();
    let targetIndex = currentIndex;

    if (key === 'ArrowRight') {
      targetIndex = (currentIndex + 1) % routes.length;
    } else if (key === 'ArrowLeft') {
      targetIndex = (currentIndex - 1 + routes.length) % routes.length;
    } else if (key === 'Home') {
      targetIndex = 0;
    } else if (key === 'End') {
      targetIndex = routes.length - 1;
    }

    const targetRoute = routes[targetIndex];
    if (targetRoute) {
      this.selectTab(targetRoute.path);
    }

    return targetIndex;
  }

  /**
   * Generates clean accessible HTML structure for the shell layout
   */
  public renderHtml(contentHtml: string = ''): string {
    const activeRoute = this.getActiveRoute();
    const routes = getAllCrm2Routes();
    const breadcrumbs = this.getBreadcrumbs();

    const breadcrumbsHtml = breadcrumbs
      .map((crumb, idx) => {
        const isLast = idx === breadcrumbs.length - 1;
        if (isLast || !crumb.href) {
          return `<li class="cs-breadcrumb-item"><span class="cs-breadcrumb-current" aria-current="page">${crumb.label}</span></li>`;
        }
        return `<li class="cs-breadcrumb-item"><a href="${crumb.href}" class="cs-breadcrumb-link">${crumb.label}</a></li>`;
      })
      .join('');

    const tabsHtml = routes
      .map((route) => {
        const isActive = route.path === activeRoute.path;
        return `<button role="tab" id="tab-${route.id}" aria-controls="panel-${route.id}" aria-selected="${isActive}" tabindex="${isActive ? 0 : -1}" class="cs-tab-button ${isActive ? 'cs-tab-active' : ''}">${route.navLabel}</button>`;
      })
      .join('');

    return `
<div class="cs-crm2-shell">
  <a href="#main-content" class="cs-skip-link">Skip to main content</a>
  <header class="cs-shell-header" role="banner">
    <nav aria-label="Breadcrumb" class="cs-breadcrumbs">
      <ol class="cs-breadcrumb-list">${breadcrumbsHtml}</ol>
    </nav>
    <div class="cs-shell-title-row">
      <div class="cs-shell-title-group">
        <h1 class="cs-shell-title">${MODULE_TITLE}</h1>
        <span class="cs-module-badge" aria-label="Module identifier: CRM-2">CRM-2</span>
      </div>
    </div>
    <div role="tablist" aria-label="CRM-2 Navigation" class="cs-tablist">${tabsHtml}</div>
  </header>
  <main id="main-content" class="cs-shell-main" role="main">
    <div role="tabpanel" id="panel-${activeRoute.id}" aria-labelledby="tab-${activeRoute.id}" class="cs-tabpanel">
      ${contentHtml}
    </div>
  </main>
</div>`.trim();
  }
}
