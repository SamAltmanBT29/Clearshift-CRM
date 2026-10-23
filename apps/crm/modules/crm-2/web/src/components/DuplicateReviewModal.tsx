import React, { useState } from 'react';
import type {
  Crm2DuplicateCandidate,
  Crm2ResolveDuplicateInput,
  DuplicateReviewDecision,
} from '@clearshift/contracts';
import { Button, Input, Select, Alert, Badge } from '@clearshift/ui';

export interface DuplicateReviewModalProps {
  candidate: Crm2DuplicateCandidate | null;
  isOpen: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onResolve: (input: Crm2ResolveDuplicateInput) => Promise<void>;
}

export function DuplicateReviewModal({
  candidate,
  isOpen,
  isSubmitting = false,
  onClose,
  onResolve,
}: DuplicateReviewModalProps) {
  if (!isOpen || !candidate) return null;

  const [decision, setDecision] = useState<DuplicateReviewDecision>('MERGE');
  const [actorId, setActorId] = useState('operator-admin');
  const [keptId, setKeptId] = useState(candidate.recordIds[0] || '');
  const [mergedId, setMergedId] = useState(candidate.recordIds[1] || candidate.recordIds[0] || '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!actorId.trim()) {
      setError('Actor ID is required for audited human resolution');
      return;
    }

    if (!reason.trim()) {
      setError('Review rationale / reason is required');
      return;
    }

    if (decision === 'MERGE') {
      if (!keptId || !mergedId) {
        setError('Both Kept ID and Merged ID must be selected');
        return;
      }
      if (keptId === mergedId) {
        setError('Kept Record ID and Merged Record ID must be distinct entities');
        return;
      }
    }

    try {
      await onResolve({
        candidateId: candidate.id,
        decision,
        actorId: actorId.trim(),
        keptId: decision === 'MERGE' ? keptId : candidate.recordIds[0] || 'n/a',
        mergedId: decision === 'MERGE' ? mergedId : candidate.recordIds[1] || candidate.recordIds[0] || 'n/a',
        reason: reason.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record merge decision');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full p-6 border border-slate-200 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div>
            <h2 id="duplicate-modal-title" className="text-lg font-bold text-slate-900">
              Human Review: Duplicate Candidate
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Candidate ID: {candidate.id}
            </p>
          </div>
          <Badge variant="warning">Held for Review</Badge>
        </div>

        {/* Candidate Details Card */}
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200 text-xs space-y-1.5 mb-4">
          <div className="flex justify-between">
            <span className="text-slate-500">Key Type:</span>
            <span className="font-semibold text-slate-800 font-mono">{candidate.keyType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Normalized Key:</span>
            <span className="font-semibold text-indigo-700 font-mono break-all">
              {candidate.normalizedKey}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Target Entity:</span>
            <span className="font-medium text-slate-700 capitalize">{candidate.entity}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Matched Record IDs ({candidate.recordIds.length}):</span>
            <span className="font-mono text-slate-600 truncate max-w-[260px]">
              {candidate.recordIds.join(', ')}
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-sm">
          {/* Decision */}
          <div>
            <label htmlFor="review-decision" className="block text-xs font-semibold text-slate-700 mb-1">
              Review Decision <span className="text-red-500">*</span>
            </label>
            <select
              id="review-decision"
              value={decision}
              onChange={(e) => setDecision(e.target.value as DuplicateReviewDecision)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="MERGE">MERGE (Consolidate into Kept Master Record)</option>
              <option value="REJECT_DUPLICATE">REJECT_DUPLICATE (Drop duplicate record)</option>
              <option value="KEEP_SEPARATE">KEEP_SEPARATE (Verified distinct business records)</option>
            </select>
          </div>

          {/* Merge Kept vs Merged Selectors */}
          {decision === 'MERGE' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-amber-50/60 border border-amber-200 rounded-lg">
              <div>
                <label htmlFor="kept-id-select" className="block text-xs font-semibold text-emerald-800 mb-1">
                  Master Record to Keep <span className="text-red-500">*</span>
                </label>
                <select
                  id="kept-id-select"
                  value={keptId}
                  onChange={(e) => setKeptId(e.target.value)}
                  className="w-full rounded border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900"
                >
                  {candidate.recordIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="merged-id-select" className="block text-xs font-semibold text-amber-800 mb-1">
                  Duplicate Record to Merge <span className="text-red-500">*</span>
                </label>
                <select
                  id="merged-id-select"
                  value={mergedId}
                  onChange={(e) => setMergedId(e.target.value)}
                  className="w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-mono text-slate-900"
                >
                  {candidate.recordIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Actor ID */}
          <div>
            <label htmlFor="actor-id-input" className="block text-xs font-semibold text-slate-700 mb-1">
              Authorized Reviewer ID <span className="text-red-500">*</span>
            </label>
            <input
              id="actor-id-input"
              type="text"
              value={actorId}
              onChange={(e) => setActorId(e.target.value)}
              placeholder="operator-id or username"
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Reason */}
          <div>
            <label htmlFor="reason-textarea" className="block text-xs font-semibold text-slate-700 mb-1">
              Resolution Rationale / Audit Justification <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reason-textarea"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Verified identical opportunity name and customer account across migration batches."
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Invariant Note */}
          <p className="text-xs text-slate-500 italic">
            Note: Automatic fuzzy merging is strictly prohibited in ClearShift V1. This human decision will be permanently registered in the audit ledger.
          </p>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Recording...' : 'Confirm Decision'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
