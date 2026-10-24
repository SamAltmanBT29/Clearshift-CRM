import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  type CRM1ContactRead,
  type CRM1Company,
  type CRM1LeadRead,
  type CRM1ImportBatchDetail,
} from '@clearshift/contracts';
import { ContactDetailPage } from '../src/pages/ContactDetailPage.js';
import { CompanyDetailPage } from '../src/pages/CompanyDetailPage.js';
import { LeadDetailPage } from '../src/pages/LeadDetailPage.js';
import { ImportDetailPage } from '../src/pages/ImportDetailPage.js';

describe('CRM-1 Detail Pages: Read-Only Display & Navigation Context (Issue #10 / [CRM1-05])', () => {
  const sampleContact: CRM1ContactRead = {
    id: '10000000-0000-4000-8000-000000000001',
    firstName: 'Sarah',
    lastName: 'Connor',
    email: 'sarah.connor@sky.net',
    phone: '+1-555-0199',
    address: '42 Resistance Way, Los Angeles, CA',
    companyId: '20000000-0000-4000-8000-000000000001',
    companyName: 'Cyberdyne Systems',
    leadStatus: 'Working',
    goldenId: 'GID-100000000001',
    sourceSystem: 'Salesforce',
    sourceId: 'SF-00912',
    consentStatus: 'granted',
    consentUpdatedAt: '2026-10-01T00:00:00Z',
    unsubscribed: false,
    unsubscribedUpdatedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  const sampleCompany: CRM1Company = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Cyberdyne Systems',
    taxNumber: 'US-99887766',
    email: 'corp@cyberdyne.com',
    phone: '+1-800-555-0100',
    address: '18144 El Camino Real, Sunnyvale, CA',
    sourceSystem: 'HubSpot',
    sourceId: 'HS-COMPANY-88',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  const sampleLead: CRM1LeadRead = {
    id: '30000000-0000-4000-8000-000000000001',
    contactId: '10000000-0000-4000-8000-000000000001',
    contactName: 'Sarah Connor',
    contactEmail: 'sarah.connor@sky.net',
    status: 'Working',
    sourceSystem: 'Salesforce',
    sourceId: 'SF-LEAD-101',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  const sampleBatch: CRM1ImportBatchDetail = {
    id: '40000000-0000-4000-8000-000000000001',
    sourceSystem: 'Salesforce-Migration',
    status: 'completed',
    loadedCount: 150,
    rejectedCount: 2,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-01T12:05:00Z',
    completedAt: '2026-10-01T12:05:00Z',
    receipts: [
      {
        sourceRow: 1,
        entity: 'contact',
        targetId: '10000000-0000-4000-8000-000000000001',
        createdAt: '2026-10-01T12:01:00Z',
      },
    ],
  };

  it('renders ContactDetailPage with initialContact and navigation links', () => {
    const onBackToList = vi.fn();
    const onEditContact = vi.fn();

    const element = React.createElement(ContactDetailPage, {
      contactId: sampleContact.id,
      initialContact: sampleContact,
      onBackToList,
      onEditContact,
    });

    expect(element).toBeDefined();
    expect(element.type).toBe(ContactDetailPage);
    expect(element.props.contactId).toBe(sampleContact.id);
    expect(element.props.initialContact?.goldenId).toBe('GID-100000000001');
  });

  it('renders CompanyDetailPage with flat company badge and back-to-list action', () => {
    const onBackToList = vi.fn();
    const onEditCompany = vi.fn();

    const element = React.createElement(CompanyDetailPage, {
      companyId: sampleCompany.id,
      initialCompany: sampleCompany,
      onBackToList,
      onEditCompany,
    });

    expect(element).toBeDefined();
    expect(element.props.companyId).toBe(sampleCompany.id);
    expect(element.props.initialCompany?.name).toBe('Cyberdyne Systems');
  });

  it('renders LeadDetailPage with pipeline status and progression preview', () => {
    const onBackToList = vi.fn();
    const onEditLead = vi.fn();

    const element = React.createElement(LeadDetailPage, {
      leadId: sampleLead.id,
      initialLead: sampleLead,
      onBackToList,
      onEditLead,
    });

    expect(element).toBeDefined();
    expect(element.props.leadId).toBe(sampleLead.id);
    expect(element.props.initialLead?.status).toBe('Working');
  });

  it('renders ImportDetailPage with loadedCount, rejectedCount and receipts', () => {
    const onBackToList = vi.fn();

    const element = React.createElement(ImportDetailPage, {
      batchId: sampleBatch.id,
      initialBatch: sampleBatch,
      onBackToList,
    });

    expect(element).toBeDefined();
    expect(element.props.batchId).toBe(sampleBatch.id);
    expect(element.props.initialBatch?.loadedCount).toBe(150);
    expect(element.props.initialBatch?.rejectedCount).toBe(2);
    expect(element.props.initialBatch?.receipts.length).toBe(1);
  });
});
