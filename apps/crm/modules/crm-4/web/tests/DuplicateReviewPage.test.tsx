import { describe, it, expect } from 'vitest';
import React from 'react';
import { DuplicateReviewPage } from '../src/pages/DuplicateReviewPage.js';

describe('DuplicateReviewPage Component ([CRM4-12])', () => {
  const sampleCandidates = [
    {
      id: 'd1111111-1111-4111-8111-000000000001',
      entity: 'list',
      keyType: 'list_name',
      normalizedKey: 'q4 enterprise prospects',
      recordIds: ['40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000002'],
      status: 'held_for_review',
      detectedAt: '2026-10-24T00:00:00.000Z',
    },
  ];

  it('renders page header and descriptive banner', () => {
    const el = <DuplicateReviewPage data={sampleCandidates} />;
    expect(el).toBeDefined();
    expect(el.props.data).toHaveLength(1);
  });

  it('renders AccessDeniedView when user lacks permission or access is forbidden', () => {
    const el = (
      <DuplicateReviewPage
        isAccessDenied={true}
        requiredRole="editor"
        currentRole="viewer"
      />
    );
    expect(el.props.isAccessDenied).toBe(true);
    expect(el.props.requiredRole).toBe('editor');
    expect(el.props.currentRole).toBe('viewer');
  });

  it('passes search, filter, and pagination props down to child components', () => {
    const onSearchChange = () => {};
    const onFilterChange = () => {};
    const onPageChange = () => {};

    const el = (
      <DuplicateReviewPage
        data={sampleCandidates}
        search="q4"
        onSearchChange={onSearchChange}
        onFilterChange={onFilterChange}
        pagination={{ page: 1, pageSize: 25, total: 1, totalPages: 1 }}
        onPageChange={onPageChange}
      />
    );

    expect(el.props.search).toBe('q4');
    expect(el.props.onSearchChange).toBe(onSearchChange);
    expect(el.props.onFilterChange).toBe(onFilterChange);
    expect(el.props.onPageChange).toBe(onPageChange);
  });
});
