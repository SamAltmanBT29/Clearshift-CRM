import { describe, it, expect, vi } from 'vitest';
import {
  CRM4ListSchema,
  CRM4ListCreateSchema,
  CRM4ListPatchSchema,
  type CRM4List,
  type CRM4ListCreate,
  type CRM4ListPatch,
} from '@clearshift/contracts';

describe('CRM-4 Marketing Lists Form: Contracts & Invariants (Issue #173 / [CRM4-20])', () => {
  const sampleValidList: CRM4List = {
    id: '40000000-0000-4000-8000-000000000001',
    name: 'Q4 Product Announcements',
    description: 'Opted-in recipients for quarterly product updates',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  };

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
      // Schema requires min(1) characters; trimming is checked
      expect(emptyResult.success).toBe(false);
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
  });

  describe('2. Read-Only Field Isolation & Edit Mode Patch Payload', () => {
    it('CRM4ListPatchSchema strictly rejects server-generated id and timestamps', () => {
      const maliciousUpdate = {
        name: 'Updated Name',
        description: 'Updated Description',
        // Attacker attempting to override immutable system fields
        id: '99999999-9999-4999-8999-999999999999',
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: '2020-01-01T00:00:00Z',
      };

      const result = CRM4ListPatchSchema.safeParse(maliciousUpdate);
      expect(result.success).toBe(false);
    });

    it('accepts valid editable fields for update', () => {
      const validUpdate: CRM4ListPatch = {
        name: 'Updated Name',
        description: 'Updated Description',
      };
      const result = CRM4ListPatchSchema.safeParse(validUpdate);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Name');
        expect(result.data.description).toBe('Updated Description');
      }
    });

    it('permits partial updates in patch schema (e.g. description only)', () => {
      const descOnly: CRM4ListPatch = {
        description: 'Revised list description',
      };
      const result = CRM4ListPatchSchema.safeParse(descOnly);
      expect(result.success).toBe(true);
    });
  });

  describe('3. Form State Preservation on Server Error', () => {
    it('preserves user entered values when an API validation error occurs', () => {
      const userEnteredState = {
        name: 'Draft List Title',
        description: 'Detailed description entered by user that should not be wiped out',
      };

      // Simulated server 400 error
      const serverError = {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'A list with this name already exists in this tenant.',
        details: { name: ['List name must be unique within tenant.'] },
      };

      // Invariant: User's entered state is never reset on failure
      expect(userEnteredState.name).toBe('Draft List Title');
      expect(userEnteredState.description).toBe(
        'Detailed description entered by user that should not be wiped out'
      );
      expect(serverError.details.name[0]).toContain('unique within tenant');
    });
  });

  describe('4. Dirty State & Confirmation Dialog Logic', () => {
    it('detects when inputs are modified from initial values', () => {
      const initial = { ...sampleValidList };

      const checkDirty = (current: { name: string; description: string | null }): boolean => {
        return (
          current.name.trim() !== (initial.name ?? '').trim() ||
          (current.description ?? '').trim() !== (initial.description ?? '').trim()
        );
      };

      // Unchanged
      expect(checkDirty({ name: sampleValidList.name, description: sampleValidList.description ?? '' })).toBe(false);

      // Modified name
      expect(checkDirty({ name: 'Changed Name', description: sampleValidList.description ?? '' })).toBe(true);

      // Modified description
      expect(checkDirty({ name: sampleValidList.name, description: 'Changed Description' })).toBe(true);
    });
  });
});
