import React, { useEffect, useRef } from 'react';
import {
  CRM2_ROUTES,
  getAllCrm2Routes,
  formatBrowserTitle,
  MODULE_TITLE,
} from '../routes.js';
import type { Crm2RouteDefinition, BreadcrumbItem } from '../types.js';
import '../styles/shell.css';

export interface Crm2ShellProps {
  activeTabKey: string;
  onTabSelect: (tabKey: string) => void;
  breadcrumbs?: BreadcrumbItem[] | undefined;
  actions?: React.ReactNode | undefined;
  children?: React.ReactNode;
}

/**
 * CRM-2 Shared Layout Shell
 * Complies with WAI-ARIA landmark navigation, keyboard tab navigation,
 * accessible skip links, and dynamic browser title updates.
 */
export const Crm2Shell: React.FC<Crm2ShellProps> = ({
  activeTabKey,
  onTabSelect,
  breadcrumbs,
  actions,
  children,
}) => {
  const routes = getAllCrm2Routes();
  const activeRoute = CRM2_ROUTES[activeTabKey] ?? routes[0]!;
  const effectiveBreadcrumbs = breadcrumbs ?? activeRoute.breadcrumbs;
  const tabListRef = useRef<HTMLDivElement>(null);

  // Synchronize document title on navigation
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = formatBrowserTitle(activeRoute.title);
    }
  }, [activeRoute]);

  // WAI-ARIA keyboard navigation for tablist (ArrowLeft, ArrowRight, Home, End)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let targetIndex = -1;
    if (e.key === 'ArrowRight') {
      targetIndex = (index + 1) % routes.length;
    } else if (e.key === 'ArrowLeft') {
      targetIndex = (index - 1 + routes.length) % routes.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = routes.length - 1;
    }

    if (targetIndex >= 0) {
      e.preventDefault();
      const targetRoute = routes[targetIndex];
      if (targetRoute) {
        onTabSelect(targetRoute.path);
        const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');
        buttons?.[targetIndex]?.focus();
      }
    }
  };

  return (
    <div className="cs-crm2-shell">
      {/* Accessibility Skip Link */}
      <a href="#main-content" className="cs-skip-link">
        Skip to main content
      </a>

      {/* ARIA Banner Landmark */}
      <header className="cs-shell-header" role="banner">
        {/* Breadcrumb Landmark */}
        <nav aria-label="Breadcrumb" className="cs-breadcrumbs">
          <ol className="cs-breadcrumb-list">
            {effectiveBreadcrumbs.map((crumb, idx) => {
              const isLast = idx === effectiveBreadcrumbs.length - 1;
              return (
                <li key={idx} className="cs-breadcrumb-item">
                  {isLast || !crumb.href ? (
                    <span className="cs-breadcrumb-current" aria-current={isLast ? 'page' : undefined}>
                      {crumb.label}
                    </span>
                  ) : (
                    <a href={crumb.href} className="cs-breadcrumb-link">
                      {crumb.label}
                    </a>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="cs-shell-title-row">
          <div className="cs-shell-title-group">
            <h1 className="cs-shell-title">{MODULE_TITLE}</h1>
            <span className="cs-module-badge" aria-label="Module identifier: CRM-2">
              CRM-2
            </span>
          </div>
          {actions && <div className="cs-shell-actions">{actions}</div>}
        </div>

        {/* ARIA Tablist Navigation Landmark */}
        <div
          ref={tabListRef}
          role="tablist"
          aria-label="CRM-2 Navigation"
          className="cs-tablist"
        >
          {routes.map((route, idx) => {
            const isActive = route.path === activeRoute.path;
            return (
              <button
                key={route.id}
                role="tab"
                id={`tab-${route.id}`}
                aria-controls={`panel-${route.id}`}
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                className={`cs-tab-button ${isActive ? 'cs-tab-active' : ''}`}
                onClick={() => onTabSelect(route.path)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
              >
                {route.navLabel}
              </button>
            );
          })}
        </div>
      </header>

      {/* ARIA Main Content Landmark */}
      <main id="main-content" className="cs-shell-main" role="main">
        <div
          role="tabpanel"
          id={`panel-${activeRoute.id}`}
          aria-labelledby={`tab-${activeRoute.id}`}
          className="cs-tabpanel"
        >
          {children}
        </div>
      </main>
    </div>
  );
};
export { Crm2ShellController, type Crm2ShellOptions } from './Crm2ShellController.js';
export default Crm2Shell;
