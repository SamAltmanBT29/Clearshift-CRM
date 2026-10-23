import { describe, it, expect } from 'vitest';
import React from 'react';
import { MappingTemplatesPage } from '../../web/pages/MappingTemplatesPage.js';
import { CRM4_MAPPING_ROUTE, findRouteByPath } from '../../web/routes.js';
import { MAPPING_TEMPLATES, ENUMS } from '../../src/kit/mapping-defaults.js';

describe('MappingTemplatesPage Frontend Component (#181, [CRM4-28])', () => {
  it('instantiates MappingTemplatesPage React element with default and custom initialEntity', () => {
    const defaultElem = React.createElement(MappingTemplatesPage);
    expect(defaultElem).toBeDefined();
    expect(defaultElem.type).toBe(MappingTemplatesPage);

    const campaignsElem = React.createElement(MappingTemplatesPage, {
      initialEntity: 'crm4_campaigns',
    });
    expect(campaignsElem).toBeDefined();
    expect(campaignsElem.props.initialEntity).toBe('crm4_campaigns');

    const membersElem = React.createElement(MappingTemplatesPage, {
      initialEntity: 'crm4_members',
    });
    expect(membersElem).toBeDefined();
    expect(membersElem.props.initialEntity).toBe('crm4_members');

    const consentsElem = React.createElement(MappingTemplatesPage, {
      initialEntity: 'crm4_consents',
    });
    expect(consentsElem).toBeDefined();
    expect(consentsElem.props.initialEntity).toBe('crm4_consents');
  });

  it('exposes CRM4_MAPPING_ROUTE metadata with valid fullPath and breadcrumbs', () => {
    const route = CRM4_MAPPING_ROUTE;
    expect(route).toBeDefined();
    expect(route.id).toBe('crm4-mappings');
    expect(route.fullPath).toBe('/crm-4/mappings');
    expect(route.title).toBe('Mapping Templates & Value Translations');
    expect(route.breadcrumbs.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves mapping route via findRouteByPath', () => {
    const route = findRouteByPath('/crm-4/mappings');
    expect(route).toBeDefined();
    expect(route?.id).toBe('crm4-mappings');
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
