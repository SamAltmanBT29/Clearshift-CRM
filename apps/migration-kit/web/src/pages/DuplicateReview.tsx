import React, { useState, useId } from 'react';
import type {
  KitDuplicateCandidate as DuplicateCandidate,
  DuplicateReviewDecisionType,
  MergeReceipt,
} from '@clearshift/contracts';

export interface DuplicateReviewProps {
  batchId?: string | undefined;
  candidates?: DuplicateCandidate[] | undefined;
  userRole?: string | undefined;
  currentUserId?: string | undefined;
  isLoading?: boolean | undefined;
  isEmpty?: boolean | undefined;
  error?: string | null | undefined;
  onSubmitDecision?: (
    candidateId: string,
    decision: DuplicateReviewDecisionType,
    options?: {
      fieldOverrides?: Record<string, 'source' | 'target'>;
      comments?: string;
    }
  ) => Promise<MergeReceipt | void> | void;
}

const AUTHORIZED_ROLES = ['editor', 'migration_admin', 'platform_admin'];

export const DuplicateReview: React.FC<DuplicateReviewProps> = ({
  batchId = 'batch-default',
  candidates = [],
  userRole = 'editor',
  currentUserId = 'user-current',
  isLoading = false,
  isEmpty = false,
  error = null,
  onSubmitDecision,
}) => {
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    candidates.length > 0 ? (candidates[0]?.id ?? null) : null
  );
  const [fieldChoices, setFieldChoices] = useState<Record<string, Record<string, 'source' | 'target'>>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, MergeReceipt>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const headingId = useId();
  const alertId = useId();

  const isRoleAuthorized = AUTHORIZED_ROLES.includes(userRole);

  const activeCandidate = candidates.find((c) => c.id === selectedCandidateId) ?? candidates[0] ?? null;

  const handleFieldChoiceChange = (candidateId: string, fieldName: string, choice: 'source' | 'target') => {
    setFieldChoices((prev) => ({
      ...prev,
      [candidateId]: {
        ...(prev[candidateId] ?? {}),
        [fieldName]: choice,
      },
    }));
  };

  const handleCommentChange = (candidateId: string, text: string) => {
    setComments((prev) => ({
      ...prev,
      [candidateId]: text,
    }));
  };

  const handleSubmit = async (decision: DuplicateReviewDecisionType) => {
    if (!activeCandidate) return;

    if (!isRoleAuthorized) {
      setActionError(`Unauthorized: Role '${userRole}' cannot authorize duplicate merge decisions. Required: editor or admin.`);
      return;
    }

    setActionError(null);
    setSubmitting(true);

    try {
      const overrides = fieldChoices[activeCandidate.id] ?? {};
      const reviewerComment = comments[activeCandidate.id] ?? '';

      const receipt = await onSubmitDecision?.(activeCandidate.id, decision, {
        fieldOverrides: overrides,
        comments: reviewerComment,
      });

      if (receipt) {
        setReceipts((prev) => ({
          ...prev,
          [activeCandidate.id]: receipt,
        }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <main
        className="cs-duplicate-review-page"
        aria-busy="true"
        aria-label="Loading duplicate candidate review"
        style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}
      >
        <div style={{ padding: '48px 0', textAlign: 'center', color: '#4b5563' }}>
          <div
            role="status"
            aria-live="polite"
            style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}
          >
            Scanning for exact duplicate candidates...
          </div>
          <p style={{ color: '#9ca3af', fontSize: '14px' }}>
            Applying normalized exact matching rules (email, phone+name, tax ID). Zero fuzzy auto-merge.
          </p>
        </div>
      </main>
    );
  }

  // 2. Global Error State
  if (error) {
    return (
      <main
        className="cs-duplicate-review-page"
        aria-label="Duplicate candidate review error"
        style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}
      >
        <div
          role="alert"
          style={{
            padding: '20px',
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
            color: '#991b1b',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0' }}>
            Duplicate Candidate Evaluation Error
          </h2>
          <p style={{ margin: 0, fontSize: '14px' }}>{error}</p>
        </div>
      </main>
    );
  }

  // 3. Empty State
  if (isEmpty || candidates.length === 0) {
    return (
      <main
        className="cs-duplicate-review-page"
        aria-label="No duplicate candidates"
        style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}
      >
        <header style={{ marginBottom: '24px' }}>
          <h1 id={headingId} style={{ fontSize: '24px', fontWeight: 700, color: '#111827', margin: 0 }}>
            Exact Duplicate Candidate Review
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '4px' }}>
            Batch: <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>{batchId}</code>
          </p>
        </header>

        <section
          role="region"
          aria-label="Empty review queue"
          style={{
            padding: '48px 24px',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }} aria-hidden="true">
            ✅
          </div>
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1f2937', marginBottom: '6px' }}>
            No Duplicate Candidates Found
          </h2>
          <p style={{ color: '#4b5563', fontSize: '14px', maxWidth: '540px', margin: '0 auto' }}>
            All incoming records in this batch are verified distinct under V1 normalized matching rules. No records require manual merge authorization.
          </p>
        </section>
      </main>
    );
  }

  // Active candidate attributes
  const candidateReceipt = activeCandidate ? receipts[activeCandidate.id] : undefined;
  const isReviewed = activeCandidate ? (activeCandidate.status !== 'pending_review' || Boolean(candidateReceipt)) : false;

  const sourceData = (activeCandidate?.sourceRecord ?? {}) as Record<string, unknown>;
  const targetData = (activeCandidate?.targetRecord ?? {}) as Record<string, unknown>;
  const allFieldKeys = Array.from(new Set([...Object.keys(sourceData), ...Object.keys(targetData)])).sort();

  return (
    <main
      className="cs-duplicate-review-page"
      aria-labelledby={headingId}
      style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif', color: '#1f2937' }}
    >
      {/* Header Banner */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: '16px',
          marginBottom: '24px',
        }}
      >
        <div>
          <h1 id={headingId} style={{ fontSize: '24px', fontWeight: 700, margin: 0, color: '#111827' }}>
            Exact Duplicate Candidate Review
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px', marginTop: '6px', marginBottom: 0 }}>
            Batch: <code style={{ backgroundColor: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>{batchId}</code> • Pending Review:{' '}
            <strong>{candidates.filter((c) => c.status === 'pending_review').length}</strong> candidates
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '13px', color: '#4b5563', marginBottom: '4px' }}>
            Reviewer: <strong>{currentUserId}</strong>
          </div>
          <span
            aria-label={`Role: ${userRole}`}
            style={{
              display: 'inline-block',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: 600,
              backgroundColor: isRoleAuthorized ? '#dcfce7' : '#fee2e2',
              color: isRoleAuthorized ? '#166534' : '#991b1b',
              border: `1px solid ${isRoleAuthorized ? '#86efac' : '#fca5a5'}`,
            }}
          >
            {isRoleAuthorized ? `Role: ${userRole} (Authorized)` : `Role: ${userRole} (Read-Only)`}
          </span>
        </div>
      </header>

      {/* Security and Invariant Notice */}
      <section
        aria-label="V1 duplicate policy"
        style={{
          backgroundColor: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '20px',
          fontSize: '13px',
          color: '#1e40af',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '16px' }}>ℹ️</span>
        <div>
          <strong>V1 Strict Invariant:</strong> Zero auto-merge. Exact normalized matches only (Email, Phone+Name, Tax ID). Companies with shared names but different tax IDs or jurisdictions are always preserved as separate entities.
        </div>
      </section>

      {/* Action Error Alert */}
      {actionError && (
        <div
          id={alertId}
          role="alert"
          style={{
            padding: '14px 18px',
            backgroundColor: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: '8px',
            color: '#991b1b',
            fontSize: '14px',
            marginBottom: '20px',
          }}
        >
          <strong>Action Blocked:</strong> {actionError}
        </div>
      )}

      {/* Main Review Workspace */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '24px' }}>
        {/* Left Column: Candidate List */}
        <nav
          aria-label="Duplicate Candidates List"
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#f9fafb',
              borderBottom: '1px solid #e5e7eb',
              fontWeight: 600,
              fontSize: '14px',
              color: '#374151',
            }}
          >
            Candidate Queue ({candidates.length})
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {candidates.map((cand) => {
              const isSelected = cand.id === activeCandidate?.id;
              const hasReceipt = Boolean(receipts[cand.id]);
              return (
                <li key={cand.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCandidateId(cand.id);
                      setActionError(null);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 16px',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      border: 'none',
                      borderLeft: isSelected ? '4px solid #2563eb' : '4px solid transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                    aria-current={isSelected ? 'true' : undefined}
                    aria-label={`Candidate row ${cand.sourceRow}, rule ${cand.matchingRule}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>
                        Row #{cand.sourceRow}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 500,
                          backgroundColor: hasReceipt || cand.status !== 'pending_review' ? '#dcfce7' : '#fef3c7',
                          color: hasReceipt || cand.status !== 'pending_review' ? '#166534' : '#92400e',
                        }}
                      >
                        {hasReceipt ? 'MERGED' : cand.status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#4b5563' }}>
                      Rule: <code>{cand.matchingRule}</code>
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Evidence: {cand.evidence}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Right Column: Comparison & Decision Workspace */}
        {activeCandidate && (
          <section
            aria-label="Candidate Comparison & Decision"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '24px',
            }}
          >
            {/* Candidate Metadata Banner */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#f9fafb',
                padding: '12px 16px',
                borderRadius: '6px',
                marginBottom: '20px',
                border: '1px solid #e5e7eb',
              }}
            >
              <div>
                <span style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Rule Evidence
                </span>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>
                  Matched Rule: <code style={{ color: '#2563eb' }}>{activeCandidate.matchingRule}</code> (v{activeCandidate.matchingRuleVersion})
                </div>
                <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
                  Evidence: <strong>{activeCandidate.evidence}</strong>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>Target Entity ID</span>
                <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: 600, color: '#374151' }}>
                  {activeCandidate.targetId}
                </div>
              </div>
            </div>

            {/* Side-by-side Attribute Comparison Table */}
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#111827', marginBottom: '12px' }}>
              Side-by-Side Field Resolution
            </h2>
            <p style={{ fontSize: '13px', color: '#6b7280', marginTop: 0, marginBottom: '16px' }}>
              Choose which values to retain in the merged record. Conflicting values are highlighted.
            </p>

            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
                marginBottom: '24px',
                border: '1px solid #e5e7eb',
              }}
              aria-label="Side by side attribute resolution table"
            >
              <thead>
                <tr style={{ backgroundColor: '#f9fafb', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151' }}>Field</th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151' }}>
                    Source Row #{activeCandidate.sourceRow} (Incoming)
                  </th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151' }}>
                    Target Record ({activeCandidate.targetId})
                  </th>
                  <th style={{ padding: '10px 14px', fontWeight: 600, color: '#374151' }}>Retain on Merge</th>
                </tr>
              </thead>
              <tbody>
                {allFieldKeys.map((field) => {
                  const sVal = String(sourceData[field] ?? '—');
                  const tVal = String(targetData[field] ?? '—');
                  const isConflict = sVal !== tVal && sVal !== '—' && tVal !== '—';
                  const candidateChoices = fieldChoices[activeCandidate.id] ?? {};
                  const selectedChoice = candidateChoices[field] ?? (isConflict ? 'target' : 'target');

                  return (
                    <tr
                      key={field}
                      style={{
                        borderBottom: '1px solid #f3f4f6',
                        backgroundColor: isConflict ? '#fffbeb' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1f2937' }}>
                        {field}
                        {isConflict && (
                          <span
                            aria-label="Field conflict"
                            style={{
                              marginLeft: '6px',
                              fontSize: '10px',
                              backgroundColor: '#fef3c7',
                              color: '#b45309',
                              padding: '2px 4px',
                              borderRadius: '4px',
                            }}
                          >
                            DIFF
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#374151', fontFamily: 'monospace' }}>
                        {sVal}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#374151', fontFamily: 'monospace' }}>
                        {tVal}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {isConflict ? (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`choice_${activeCandidate.id}_${field}`}
                                checked={selectedChoice === 'target'}
                                disabled={isReviewed || !isRoleAuthorized}
                                onChange={() => handleFieldChoiceChange(activeCandidate.id, field, 'target')}
                              />
                              Target
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
                              <input
                                type="radio"
                                name={`choice_${activeCandidate.id}_${field}`}
                                checked={selectedChoice === 'source'}
                                disabled={isReviewed || !isRoleAuthorized}
                                onChange={() => handleFieldChoiceChange(activeCandidate.id, field, 'source')}
                              />
                              Source
                            </label>
                          </div>
                        ) : (
                          <span style={{ color: '#9ca3af', fontSize: '12px' }}>Identical</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Audit Comments */}
            <div style={{ marginBottom: '24px' }}>
              <label
                htmlFor={`comments_${activeCandidate.id}`}
                style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}
              >
                Audited Reviewer Rationale / Notes:
              </label>
              <textarea
                id={`comments_${activeCandidate.id}`}
                rows={2}
                disabled={isReviewed || !isRoleAuthorized}
                value={comments[activeCandidate.id] ?? ''}
                onChange={(e) => handleCommentChange(activeCandidate.id, e.target.value)}
                placeholder="Required or recommended comments detailing why this merge or separation was authorized..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid #d1d5db',
                  fontSize: '13px',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Decision Receipt View (if already decided) */}
            {candidateReceipt && (
              <div
                style={{
                  padding: '16px',
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #86efac',
                  borderRadius: '8px',
                  marginBottom: '20px',
                }}
              >
                <div style={{ fontWeight: 600, color: '#166534', fontSize: '14px', marginBottom: '6px' }}>
                  ✅ Audited Merge Executed & Recorded
                </div>
                <div style={{ fontSize: '12px', color: '#15803d' }}>
                  <div><strong>Kept Entity ID:</strong> {candidateReceipt.keptId}</div>
                  <div><strong>Receipt Hash:</strong> <code style={{ wordBreak: 'break-all' }}>{candidateReceipt.idempotencyKey}</code></div>
                  <div><strong>Decision At:</strong> {candidateReceipt.reviewedAt instanceof Date ? candidateReceipt.reviewedAt.toISOString() : String(candidateReceipt.reviewedAt)}</div>
                  <div><strong>Authorized By:</strong> {candidateReceipt.reviewer}</div>
                </div>
              </div>
            )}

            {/* Decision Action Buttons */}
            {!isReviewed && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  disabled={submitting || !isRoleAuthorized}
                  onClick={() => handleSubmit('keep_both')}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #d1d5db',
                    color: '#374151',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: isRoleAuthorized && !submitting ? 'pointer' : 'not-allowed',
                  }}
                  aria-label="Keep both records as separate entities"
                >
                  Keep Both (No Merge)
                </button>
                <button
                  type="button"
                  disabled={submitting || !isRoleAuthorized}
                  onClick={() => handleSubmit('merge')}
                  style={{
                    padding: '10px 22px',
                    backgroundColor: isRoleAuthorized ? '#2563eb' : '#9ca3af',
                    border: 'none',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontWeight: 600,
                    fontSize: '14px',
                    cursor: isRoleAuthorized && !submitting ? 'pointer' : 'not-allowed',
                  }}
                  aria-label="Authorize audited merge into target record"
                >
                  {submitting ? 'Submitting...' : 'Authorize & Merge Record'}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
};
