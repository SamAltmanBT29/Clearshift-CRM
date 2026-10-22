import React, { useEffect, useRef } from 'react';
import {
  CRM5_ROUTES,
  getAllCrm5Routes,
  formatBrowserTitle,
  MODULE_TITLE,
} from '../routes.js';
import type { Crm5RouteDefinition } from '../types.js';

export interface Crm5ShellProps {
  activeTabKey: string;
  onTabSelect: (tabKey: string) => void;
  children?: React.ReactNode;
}

/**
 * CRM-5 Shared Layout Shell
 * Complies with WAI-ARIA landmark navigation, keyboard tab navigation,
 * accessible skip links, and dynamic browser title updates.
 */
export const Crm5Shell: React.FC<Crm5ShellProps> = ({
  activeTabKey,
  onTabSelect,
  children,
}) => {
  const routes = getAllCrm5Routes();
  const activeRoute = CRM5_ROUTES[activeTabKey] ?? routes[0]!;
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
    <div className="cs-crm5-shell">
      {/* Accessibility Skip Link */}
      <a href="#main-content" className="cs-skip-link">
        Skip to main content
      </a>

      {/* ARIA Banner Landmark */}
      <header className="cs-shell-header" role="banner">
        {/* Breadcrumb Landmark */}
        <nav aria-label="Breadcrumb" className="cs-breadcrumbs">
          <ol className="cs-breadcrumb-list">
            {activeRoute.breadcrumbs.map((crumb, idx) => {
              const isLast = idx === activeRoute.breadcrumbs.length - 1;
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
          <h1 className="cs-shell-title">{MODULE_TITLE}</h1>
          <span className="cs-module-badge" aria-label="Module identifier: CRM-5">
            CRM-5
          </span>
        </div>
      </header>

      {/* ARIA Tablist Navigation Landmark */}
      <nav aria-label="Module Navigation" className="cs-tab-nav" role="tablist" ref={tabListRef}>
        {routes.map((route: Crm5RouteDefinition, idx: number) => {
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
      </nav>

      {/* ARIA Main Content Landmark */}
      <main
        id="main-content"
        className="cs-shell-main"
        role="main"
        tabIndex={-1}
        aria-labelledby={`tab-${activeRoute.id}`}
      >
        <section
          id={`panel-${activeRoute.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${activeRoute.id}`}
        >
          {children}
        </section>
      </main>
    </div>
  );
};
