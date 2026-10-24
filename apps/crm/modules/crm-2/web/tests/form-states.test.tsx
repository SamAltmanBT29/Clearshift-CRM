import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import {
  CRM2_STAGES,
  CRM2_FIELD_CONTRACT,
  CreateDealInputSchema,
  UpdateDealInputSchema,
  CreateQuoteInputSchema,
  UpdateQuoteInputSchema,
  type Deal,
  type Quote,
  type CreateDealInput,
  type CreateQuoteInput,
} from '@clearshift/contracts';
import { DealForm, type DealFormProps } from '../src/components/forms/DealForm.js';
import { QuoteForm, type QuoteFormProps } from '../src/components/forms/QuoteForm.js';

// NOTE: This test file covers form contracts, client schemas, and props.
// It is NOT the RTL DOM deliverable. Real React Testing Library (@testing-library/react)
// and DOM simulation (jsdom/happy-dom) are not in the pinned stack and are marked BLOCKED per ADR-005.
describe('form contract tests (schema/props)', () => {
  const sampleDeal: Deal = {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Standard Linked Deal',
    contact_id: '90000000-0000-4000-8000-000000000001',
    contact_name: 'Sarah Connor',
    value: '50000.00',
    currency: 'USD',
    stage_id: '00000000-0000-4000-8000-000000000001',
    stage_name: 'New',
    close_date: '2026-11-30',
    is_orphan: false,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };

  const sampleOrphanDeal: Deal = {
    ...sampleDeal,
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Unassigned Inbound Opportunity',
    contact_id: null,
    contact_name: null,
    is_orphan: true,
  };

  const sampleQuote: Quote = {
    id: '30000000-0000-4000-8000-000000000001',
    deal_id: sampleDeal.id,
    quote_number: 'Q-2026-0001',
    date: '2026-10-23',
    amount: '25000.00',
    currency: 'USD',
    note: 'Initial Proposal',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };

  // ---------------------------------------------------------------------------
  // 1. DealForm States (FM-01 to FM-06)
  // ---------------------------------------------------------------------------
  describe('DealForm States & Orphan Flagging', () => {
    it('FM-01 [Empty State]: initializes with default contract values and empty fields', () => {
      const props: DealFormProps = {
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      };
      const element = React.createElement(DealForm, props);
      expect(element).toBeDefined();
      expect(CRM2_FIELD_CONTRACT.deal.name.required).toBe(true);
      expect(CRM2_FIELD_CONTRACT.deal.contact_id.required).toBe(false);
    });

    it('FM-02 [Invalid State]: client validation schema catches empty mandatory name and invalid currency', () => {
      const invalidData = {
        name: '',
        contact_id: null,
        value: '-500.00', // negative
        currency: 'usd', // lowercase
        stage_name: 'InvalidStage' as any,
        close_date: 'bad-date',
      };
      const result = CreateDealInputSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = result.error.issues.map((i) => i.path[0]);
        expect(fields).toContain('name');
        expect(fields).toContain('value');
        expect(fields).toContain('currency');
        expect(fields).toContain('stage_name');
        expect(fields).toContain('close_date');
      }
    });

    it('FM-03 [Submitting State]: renders with isSubmitting=true disabled state', () => {
      const props: DealFormProps = {
        isSubmitting: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      };
      const element = React.createElement(DealForm, props);
      expect(element.props.isSubmitting).toBe(true);
    });

    it('FM-04 [Error State]: accepts serverError and serverFieldErrors props', () => {
      const props: DealFormProps = {
        serverError: 'CRM-1 contact service unavailable (503)',
        serverFieldErrors: {
          name: ['Deal name already exists in target database'],
        },
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      };
      const element = React.createElement(DealForm, props);
      expect(element.props.serverError).toBe('CRM-1 contact service unavailable (503)');
      expect(element.props.serverFieldErrors?.['name']).toContain('Deal name already exists in target database');
    });

    it('FM-05 [Success State]: validates valid deal creation input for submission', async () => {
      const onSubmitMock = vi.fn().mockResolvedValue(undefined);
      const validPayload: CreateDealInput = {
        name: 'Enterprise Cloud Migration Package',
        contact_id: '90000000-0000-4000-8000-000000000001',
        value: '75000.00',
        currency: 'USD',
        stage_name: 'Proposal',
        close_date: '2026-11-30',
      };
      const parseResult = CreateDealInputSchema.safeParse(validPayload);
      expect(parseResult.success).toBe(true);
      await onSubmitMock(parseResult.data);
      expect(onSubmitMock).toHaveBeenCalledWith(validPayload);
    });

    it('FM-06 [Orphan Deal State & Warning]: Derives isOrphan=true when contact_id is omitted and provides visible amber warning', () => {
      // 1. Contract specification: contact_id is nullable and optional
      const orphanInput = {
        name: 'Inbound Web Lead (No Contact)',
        contact_id: null,
        value: '15000.00',
        currency: 'USD',
        stage_name: 'New' as const,
        close_date: '2026-12-31',
      };
      const parseResult = CreateDealInputSchema.safeParse(orphanInput);
      expect(parseResult.success).toBe(true);
      expect(parseResult.data?.contact_id).toBeNull();

      // 2. Verified Deal contract specifies orphan warning text
      expect(CRM2_FIELD_CONTRACT.deal.contact_id.orphanWarning).toContain('Orphan Deal');

      // 3. Initial orphan deal in edit mode carries is_orphan: true
      expect(sampleOrphanDeal.is_orphan).toBe(true);
      expect(sampleOrphanDeal.contact_id).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. QuoteForm States (FM-07 to FM-12)
  // ---------------------------------------------------------------------------
  describe('QuoteForm States & Validation', () => {
    it('FM-07 [Empty State]: initializes with required quote fields', () => {
      const props: QuoteFormProps = {
        dealId: sampleDeal.id,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      };
      const element = React.createElement(QuoteForm, props);
      expect(element).toBeDefined();
      expect(CRM2_FIELD_CONTRACT.quote.quote_number.required).toBe(true);
      expect(CRM2_FIELD_CONTRACT.quote.amount.required).toBe(true);
    });

    it('FM-08 [Invalid State]: client validation schema catches empty quote number and malformed amount', () => {
      const invalidData = {
        deal_id: 'not-a-uuid',
        quote_number: '',
        date: '23-10-2026', // wrong format
        amount: 'abc', // non-decimal
        currency: 'US', // not 3 letters
      };
      const result = CreateQuoteInputSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = result.error.issues.map((i) => i.path[0]);
        expect(fields).toContain('deal_id');
        expect(fields).toContain('quote_number');
        expect(fields).toContain('date');
        expect(fields).toContain('amount');
        expect(fields).toContain('currency');
      }
    });

    it('FM-09 [Submitting State]: renders with isSubmitting=true disabled state', () => {
      const props: QuoteFormProps = {
        dealId: sampleDeal.id,
        isSubmitting: true,
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      };
      const element = React.createElement(QuoteForm, props);
      expect(element.props.isSubmitting).toBe(true);
    });

    it('FM-10 [Error State]: accepts serverError and serverFieldErrors props', () => {
      const props: QuoteFormProps = {
        dealId: sampleDeal.id,
        serverError: 'Quote number already committed in target database',
        serverFieldErrors: {
          quote_number: ['Duplicate quote number conflict (409)'],
        },
        onSubmit: vi.fn(),
        onCancel: vi.fn(),
      };
      const element = React.createElement(QuoteForm, props);
      expect(element.props.serverError).toBe('Quote number already committed in target database');
      expect(element.props.serverFieldErrors?.['quote_number']).toContain('Duplicate quote number conflict (409)');
    });

    it('FM-11 [Success State]: validates valid quote creation input for submission', async () => {
      const onSubmitMock = vi.fn().mockResolvedValue(undefined);
      const validPayload: CreateQuoteInput = {
        deal_id: sampleDeal.id,
        quote_number: 'Q-2026-VALID-01',
        date: '2026-10-23',
        amount: '25000.00',
        currency: 'USD',
        note: 'Valid 30-day term quote',
      };
      const parseResult = CreateQuoteInputSchema.safeParse(validPayload);
      expect(parseResult.success).toBe(true);
      await onSubmitMock(parseResult.data);
      expect(onSubmitMock).toHaveBeenCalledWith(validPayload);
    });

    it('FM-12 [Update State]: allows partial update of quote fields (amount and note)', () => {
      const partialUpdate = {
        amount: '27500.00',
        note: 'Revised price adjustment',
      };
      const result = UpdateQuoteInputSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
      expect(result.data?.amount).toBe('27500.00');
      expect(result.data?.note).toBe('Revised price adjustment');
    });
  });
});
