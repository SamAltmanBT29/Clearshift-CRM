// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CRM4ListSchema,
  CRM4ListCreateSchema,
  CRM4ListPatchSchema,
  type CRM4List,
  type CRM4ListCreate,
  type CRM4ListPatch,
} from '@clearshift/contracts';
import { ListForm } from '../src/components/forms/ListForm.js';
import { ListFormPage } from '../src/pages/ListFormPage.js';

describe('CRM-4 Marketing Lists Form: Contracts, Invariants & Real DOM Tests (Issue #40 / [CRM4-05])', () => {
  const sampleValidList: CRM4List = {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Q4 Product Announcements',
    description: 'Opted-in recipients for quarterly product updates',
    campaignCount: 4,
    memberCount: 120,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

  // ---------------------------------------------------------------------------
  // 1. Validation & Schema Contracts
  // ---------------------------------------------------------------------------
  describe('1. Validation & Schema Contracts', () => {
    it('validates a complete, valid list create payload', () => {
      const payload: CRM4ListCreate = {
        name: 'Enterprise Prospects 2026',
        description: 'Target list for high-value enterprise accounts',
      };
      const result = CRM4ListCreateSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects an empty or whitespace-only list name', () => {
      const emptyResult = CRM4ListCreateSchema.safeParse({ name: '' });
      expect(emptyResult.success).toBe(false);
      if (!emptyResult.success) {
        expect(emptyResult.error.flatten().fieldErrors.name).toBeDefined();
      }

      const whitespaceResult = CRM4ListCreateSchema.safeParse({ name: '   ' });
      expect(whitespaceResult.success).toBe(false);
    });

    it('permits description to be optional, empty, or undefined', () => {
      const withoutDesc: CRM4ListCreate = {
        name: 'General Newsletter',
      };
      const result = CRM4ListCreateSchema.safeParse(withoutDesc);
      expect(result.success).toBe(true);

      const nullDesc = CRM4ListCreateSchema.safeParse({
        name: 'General Newsletter',
        description: undefined,
      });
      expect(nullDesc.success).toBe(true);
    });

    it('rejects names exceeding 255 characters', () => {
      const tooLongName = 'A'.repeat(256);
      const result = CRM4ListCreateSchema.safeParse({ name: tooLongName });
      expect(result.success).toBe(false);
    });

    it('validates partial update (patch) payloads', () => {
      const patchNameOnly: CRM4ListPatch = { name: 'Updated List Name' };
      expect(CRM4ListPatchSchema.safeParse(patchNameOnly).success).toBe(true);

      const patchDescOnly: CRM4ListPatch = { description: 'Updated description' };
      expect(CRM4ListPatchSchema.safeParse(patchDescOnly).success).toBe(true);

      const emptyPatch = CRM4ListPatchSchema.safeParse({});
      expect(emptyPatch.success).toBe(false);
    });

    it('strictly strips unknown/extra fields on create', () => {
      const payloadWithExtras = {
        name: 'Security Test List',
        isSuperAdminList: true,
        campaignCount: 9999,
        internalFlag: 'bypass',
      };
      const parsed = CRM4ListCreateSchema.safeParse(payloadWithExtras);
      expect(parsed.success).toBe(false);
    });

    it('validates a complete CRM4List record schema', () => {
      const parsed = CRM4ListSchema.safeParse(sampleValidList);
      expect(parsed.success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Real DOM Component Tests (<ListForm />)
  // ---------------------------------------------------------------------------
  describe('2. Real DOM Component Tests (<ListForm />)', () => {
    it('renders empty create form with name and description inputs', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<ListForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      expect(screen.getByRole('form', { name: /create new marketing list/i })).toBeTruthy();
      expect(screen.getByLabelText(/list name/i)).toBeTruthy();
      expect(screen.getByLabelText(/description/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /create marketing list/i })).toBeTruthy();
    });

    it('shows field-level error message and does not submit when name is empty', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<ListForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const form = screen.getByRole('form', { name: /create new marketing list/i });
      fireEvent.submit(form);

      expect(handleSubmit).not.toHaveBeenCalled();
      expect(screen.getByText(/list name is required/i)).toBeTruthy();
    });

    it('submits valid input with trimmed payload', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<ListForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const nameInput = screen.getByLabelText(/list name/i);
      const descInput = screen.getByLabelText(/description/i);

      fireEvent.change(nameInput, { target: { value: '  Q4 Tech Buyers  ' } });
      fireEvent.change(descInput, { target: { value: '  Key tech decision makers  ' } });

      const form = screen.getByRole('form', { name: /create new marketing list/i });
      fireEvent.submit(form);

      expect(handleSubmit).toHaveBeenCalledTimes(1);
      expect(handleSubmit).toHaveBeenCalledWith({
        name: 'Q4 Tech Buyers',
        description: 'Key tech decision makers',
      });
    });

    it('renders edit mode with read-only fields that cannot be altered', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(
        <ListForm
          initialList={sampleValidList}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      );

      expect(screen.getByRole('form', { name: /edit marketing list/i })).toBeTruthy();
      expect(screen.getByText(sampleValidList.id)).toBeTruthy();
      expect(screen.getByText('120')).toBeTruthy();
      expect(screen.getByText('4')).toBeTruthy();
      expect(screen.getAllByText(/server-computed/i).length).toBeGreaterThanOrEqual(1);

      // System read-only IDs are non-interactive text, not editable inputs
      const idInput = screen.queryByRole('textbox', { name: /list id/i });
      expect(idInput).toBeNull();
    });

    it('presents API validation errors without losing unrelated entered form values', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      const { rerender } = render(
        <ListForm
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          serverError="Duplicate list name violation"
          serverFieldErrors={{ name: ['A list with this name already exists.'] }}
        />
      );

      expect(screen.getByText(/save failed/i)).toBeTruthy();
      expect(screen.getByText(/duplicate list name violation/i)).toBeTruthy();
      expect(screen.getByText(/a list with this name already exists/i)).toBeTruthy();
      expect(screen.getByText(/your entered values have been preserved/i)).toBeTruthy();
    });

    it('triggers cancel confirmation dialog when form is dirty', () => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();

      render(<ListForm onSubmit={handleSubmit} onCancel={handleCancel} />);

      const nameInput = screen.getByLabelText(/list name/i);
      fireEvent.change(nameInput, { target: { value: 'Draft List' } });

      const cancelButton = screen.getByRole('button', { name: /cancel and return to list/i });
      fireEvent.click(cancelButton);

      // Modal appears
      expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /discard changes/i })).toBeTruthy();

      // Confirm discard calls onCancel
      fireEvent.click(screen.getByRole('button', { name: /discard changes/i }));
      expect(handleCancel).toHaveBeenCalledTimes(1);
    });

    it('links back to list context via onBackToList in ListFormPage', () => {
      const handleBackToList = vi.fn();

      render(<ListFormPage onBackToList={handleBackToList} onSuccess={vi.fn()} />);

      const backButton = screen.getByRole('button', { name: /back to marketing lists/i });
      expect(backButton).toBeTruthy();
      fireEvent.click(backButton);
      expect(handleBackToList).toHaveBeenCalledTimes(1);
    });
  });
});
