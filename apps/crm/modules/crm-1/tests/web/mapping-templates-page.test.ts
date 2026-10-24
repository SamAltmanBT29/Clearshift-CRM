import { describe, it, expect } from 'vitest';
import React from 'react';
import { MappingTemplatesPage } from '../../web/pages/MappingTemplatesPage.js';
import { CRM1_MAPPING_ROUTE, findRouteByPath } from '../../web/routes.js';
import { MAPPING_TEMPLATES, ENUMS } from '../../src/kit/mapping-defaults.js';

describe('MappingTemplatesPage Frontend Component (#121, [CRM1-28])', () => {
  it('instantiates MappingTemplatesPage React element with default and custom initialEntity', () => {
    const defaultElem = React.createElement(MappingTemplatesPage);
    expect(defaultElem).toBeDefined();
    expect(defaultElem.type).toBe(MappingTemplatesPage);

    const companiesElem = React.createElement(MappingTemplatesPage, {
      initialEntity: 'crm1_companies',
    });
    expect(companiesElem).toBeDefined();
    expect(companiesElem.props.initialEntity).toBe('crm1_companies');

    const leadsElem = React.createElement(MappingTemplatesPage, {
      initialEntity: 'crm1_leads',
    });
    expect(leadsElem).toBeDefined();
    expect(leadsElem.props.initialEntity).toBe('crm1_leads');
  });

  it('exposes CRM1_MAPPING_ROUTE metadata with valid fullPath and breadcrumbs', () => {
    expect(CRM1_MAPPING_ROUTE.id).toBe('crm1-mappings');
    expect(CRM1_MAPPING_ROUTE.fullPath).toBe('/crm-1/mappings');
    expect(CRM1_MAPPING_ROUTE.title).toBe('Field Mapping & Enum Translation');
    expect(CRM1_MAPPING_ROUTE.breadcrumbs.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves mapping route via findRouteByPath', () => {
    const route = findRouteByPath('/crm-1/mappings');
    expect(route).toBeDefined();
    expect(route?.id).toBe('crm1-mappings');
  });

  it('guarantees that all templates have valid field definitions and matching enums', () => {
    for (const template of MAPPING_TEMPLATES) {
      expect(template.id).toBeDefined();
      expect(template.name).toBeDefined();
      expect(template.version).toBeGreaterThanOrEqual(1);
      expect(template.fields.length).toBeGreaterThan(0);

      // Verify that every enum reference points to a registered enum in ENUMS
      for (const field of template.fields) {
        if (field.enumName) {
          expect(ENUMS[field.enumName]).toBeDefined();
          expect(ENUMS[field.enumName].allowlist.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
