import {
  CRM1_ROUTES,
  getAllCrm1Routes,
  formatBrowserTitle,
  MODULE_TITLE,
} from '../routes.js';
import type { Crm1RouteDefinition } from '../types.js';

export interface Crm1ShellOptions {
  activeTabKey: string;
  onTabSelect?: ((tabKey: string) => void) | undefined;
}

/**
 * CRM-1 Layout Shell and Navigation Controller
 * Manages WAI-ARIA tab navigation, keyboard events (ArrowLeft, ArrowRight, Home, End),
 * breadcrumb generation, and dynamic document title synchronization.
 */
export class Crm1ShellController {
  private activeTabKey: string;
  private onTabSelect?: ((tabKey: string) => void) | undefined;

  constructor(options: Crm1ShellOptions) {
    this.activeTabKey = options.activeTabKey;
    this.onTabSelect = options.onTabSelect;
    this.syncDocumentTitle();
  }

  public getActiveRoute(): Crm1RouteDefinition {
    return CRM1_ROUTES[this.activeTabKey] ?? getAllCrm1Routes()[0]!;
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
    const routes = getAllCrm1Routes();
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
    const routes = getAllCrm1Routes();

    const breadcrumbsHtml = activeRoute.breadcrumbs
      .map((crumb, idx) => {
        const isLast = idx === activeRoute.breadcrumbs.length - 1;
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
<div class="cs-crm1-shell">
  <a href="#main-content" class="cs-skip-link">Skip to main content</a>
  <header class="cs-shell-header" role="banner">
    <nav aria-label="Breadcrumb" class="cs-breadcrumbs">
      <ol class="cs-breadcrumb-list">${breadcrumbsHtml}</ol>
    </nav>
    <div class="cs-shell-title-row">
      <h1 class="cs-shell-title">${MODULE_TITLE}</h1>
      <span class="cs-module-badge" aria-label="Module identifier: CRM-1">CRM-1</span>
    </div>
  </header>
  <nav aria-label="Module Navigation" class="cs-tab-nav" role="tablist">
    ${tabsHtml}
  </nav>
  <main id="main-content" class="cs-shell-main" role="main" tabindex="-1" aria-labelledby="tab-${activeRoute.id}">
    <section id="panel-${activeRoute.id}" role="tabpanel" aria-labelledby="tab-${activeRoute.id}">
      ${contentHtml}
    </section>
  </main>
</div>`;
  }
}
