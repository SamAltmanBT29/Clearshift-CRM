import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { Crm2Shell, Crm2ShellController } from '../src/shell/Crm2Shell.js';

describe('Crm2Shell Layout Shell & Controller', () => {
  it('instantiates Crm2Shell component and exposes functional component signature', () => {
    expect(typeof Crm2Shell).toBe('function');

    const onTabSelect = vi.fn();
    const element = React.createElement(
      Crm2Shell,
      {
        activeTabKey: 'deals',
        onTabSelect,
      },
      React.createElement('div', { 'data-testid': 'test-child' }, 'Deals View')
    );

    expect(element).toBeDefined();
    expect(element.props.activeTabKey).toBe('deals');
    expect(element.props.children).toBeDefined();
  });

  it('renders all 3 navigation tabs with ARIA roles and labels via controller', () => {
    const onTabSelect = vi.fn();
    const controller = new Crm2ShellController({
      activeTabKey: 'deals',
      onTabSelect,
    });

    const html = controller.renderHtml('<div data-testid="child-content">Deals Content</div>');

    expect(html).toContain('role="banner"');
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('role="main"');
    expect(html).toContain('Deals Content');

    // Tab buttons
    expect(html).toContain('id="tab-crm2-deals"');
    expect(html).toContain('id="tab-crm2-pipeline"');
    expect(html).toContain('id="tab-crm2-quotes"');
  });

  it('marks active tab with aria-selected="true" and inactive tabs with aria-selected="false"', () => {
    const controllerDeals = new Crm2ShellController({ activeTabKey: 'deals' });
    const htmlDeals = controllerDeals.renderHtml('<div>Deals</div>');

    expect(htmlDeals).toMatch(/id="tab-crm2-deals"[^>]*aria-selected="true"/);
    expect(htmlDeals).toMatch(/id="tab-crm2-pipeline"[^>]*aria-selected="false"/);

    const controllerPipeline = new Crm2ShellController({ activeTabKey: 'pipeline' });
    const htmlPipeline = controllerPipeline.renderHtml('<div>Pipeline</div>');

    expect(htmlPipeline).toMatch(/id="tab-crm2-pipeline"[^>]*aria-selected="true"/);
    expect(htmlPipeline).toMatch(/id="tab-crm2-deals"[^>]*aria-selected="false"/);
  });

  it('renders custom breadcrumbs when provided', () => {
    const customCrumbs = [
      { label: 'ClearShift', href: '/' },
      { label: 'Deals', href: '/crm-2/deals' },
      { label: 'Custom Opportunity' },
    ];

    const controller = new Crm2ShellController({
      activeTabKey: 'deals',
      breadcrumbs: customCrumbs,
    });

    const html = controller.renderHtml('<div>Content</div>');
    expect(html).toContain('Custom Opportunity');
    expect(html).toContain('aria-current="page"');
  });
});
