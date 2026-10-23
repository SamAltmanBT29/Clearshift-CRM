import React, { useState, useEffect } from 'react';
import type {
  Crm2DuplicateCandidate,
  Crm2DuplicateAuditLogEntry,
  Crm2ResolveDuplicateInput,
  DealDuplicateEvaluationResult,
  QuoteDuplicateEvaluationResult,
} from '@clearshift/contracts';
import {
  getHeldDuplicates,
  resolveDuplicate,
  getDuplicateAuditLogs,
  evaluateDealDuplicate,
  evaluateQuoteDuplicate,
} from '../api/crm-2.js';
import { DuplicateReviewModal } from '../components/DuplicateReviewModal.js';
import {
  Button,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Spinner,
  Alert,
} from '@clearshift/ui';

export interface DuplicateReviewPageProps {
  onBackToList: () => void;
}

export function DuplicateReviewPage({ onBackToList }: DuplicateReviewPageProps) {
  const [activeTab, setActiveTab] = useState<'held' | 'audit' | 'evaluator'>('held');
  const [heldCandidates, setHeldCandidates] = useState<Crm2DuplicateCandidate[]>([]);
  const [auditLogs, setAuditLogs] = useState<Crm2DuplicateAuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Review modal state
  const [selectedCandidate, setSelectedCandidate] = useState<Crm2DuplicateCandidate | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Evaluator state
  const [testDealName, setTestDealName] = useState('Acme Cloud Modernization');
  const [testDealStage, setTestDealStage] = useState('10000000-0000-4000-8000-000000000003');
  const [testDealContact, setTestDealContact] = useState('90000000-0000-4000-8000-000000000001');
  const [dealEvalResult, setDealEvalResult] = useState<DealDuplicateEvaluationResult | null>(null);

  const [testQuoteNumber, setTestQuoteNumber] = useState('Q-2026-001');
  const [quoteEvalResult, setQuoteEvalResult] = useState<QuoteDuplicateEvaluationResult | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [heldRes, auditRes] = await Promise.all([
        getHeldDuplicates(),
        getDuplicateAuditLogs({ pageSize: 50 }),
      ]);
      setHeldCandidates(heldRes.items || []);
      setAuditLogs(auditRes.items || []);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load duplicate queue data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleResolveCandidate = async (input: Crm2ResolveDuplicateInput) => {
    setIsSubmitting(true);
    try {
      await resolveDuplicate(input);
      await loadData();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestDealEval = async () => {
    try {
      const res = await evaluateDealDuplicate({
        name: testDealName,
        stageId: testDealStage,
        contactId: testDealContact || null,
      });
      setDealEvalResult(res);
    } catch (err: any) {
      alert(err.message || 'Evaluation failed');
    }
  };

  const handleTestQuoteEval = async () => {
    try {
      const res = await evaluateQuoteDuplicate({
        quoteNumber: testQuoteNumber,
      });
      setQuoteEvalResult(res);
    } catch (err: any) {
      alert(err.message || 'Evaluation failed');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header with Back button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackToList}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
            >
              &larr; Back to Deals
            </button>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            Exact Duplicate Key Policy &amp; Human Review
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Sprint 3 / Gate G3: Deterministic exact-duplicate matching and audited human resolution [CRM2-12 / KIT-10].
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={isLoading}>
            Refresh Queue
          </Button>
        </div>
      </div>

      {/* Non-negotiable policy banner */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-xs text-indigo-900 space-y-1">
        <div className="flex items-center gap-2 font-semibold">
          <Badge variant="info">V1 Invariant</Badge>
          <span>Deterministic Exact Matching Policy (Zero Fuzzy Auto-Merge)</span>
        </div>
        <p className="text-slate-700 leading-relaxed">
          In ClearShift V1, duplicate detection operates strictly via deterministic key normalizers (trimmed lowercase name, stage, contact link, quote number, SKU, or tax ID). Automatic fuzzy merging is strictly prohibited. All ambiguous or duplicate candidate groups are held for authorized human review and logged immutably.
        </p>
      </div>

      {errorMessage && <Alert variant="error">{errorMessage}</Alert>}

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('held')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'held'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Held for Review
          <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full font-mono">
            {heldCandidates.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'audit'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Resolution Audit Trail
          <span className="bg-slate-200 text-slate-700 text-xs px-2 py-0.5 rounded-full font-mono">
            {auditLogs.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('evaluator')}
          className={`pb-3 border-b-2 flex items-center gap-2 ${
            activeTab === 'evaluator'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Exact Key Evaluator
        </button>
      </div>

      {/* Tab Content: Held Candidates */}
      {activeTab === 'held' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Spinner size="lg" label="Loading duplicate candidate queue..." />
            </div>
          ) : heldCandidates.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2">
              <div className="text-2xl">&#x2714;</div>
              <h3 className="text-sm font-bold text-slate-800">Queue Clean: No Duplicate Candidates</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                No duplicate candidate groups are currently held for review. Ingestion and target data pools have 100% key uniqueness.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Candidate ID</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Key Type</TableHead>
                    <TableHead>Normalized Key</TableHead>
                    <TableHead>Candidate Records</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {heldCandidates.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs text-slate-600">{c.id.slice(0, 8)}...</TableCell>
                      <TableCell className="capitalize font-medium text-xs text-slate-800">{c.entity}</TableCell>
                      <TableCell className="font-mono text-xs text-indigo-600">{c.keyType}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-800 font-semibold">{c.normalizedKey}</TableCell>
                      <TableCell className="text-xs text-slate-600 font-mono">
                        {c.recordIds.length} records ({c.recordIds.join(', ')})
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setSelectedCandidate(c);
                            setIsModalOpen(true);
                          }}
                        >
                          Review &amp; Resolve
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Audit Log */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="py-12 flex justify-center">
              <Spinner size="lg" label="Loading audit logs..." />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2">
              <h3 className="text-sm font-bold text-slate-800">No Merge Decisions Recorded</h3>
              <p className="text-xs text-slate-500">
                Audited human merge decisions will appear here with reviewer timestamp, kept ID, and merged ID.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Reviewer Actor</TableHead>
                    <TableHead>Kept ID</TableHead>
                    <TableHead>Merged / Dropped ID</TableHead>
                    <TableHead>Key Type &amp; Key</TableHead>
                    <TableHead>Rationale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            log.decision === 'MERGE'
                              ? 'success'
                              : log.decision === 'REJECT_DUPLICATE'
                              ? 'danger'
                              : 'neutral'
                          }
                        >
                          {log.decision}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-semibold text-slate-700">{log.actorId}</TableCell>
                      <TableCell className="font-mono text-xs text-emerald-700 font-semibold">{log.keptId}</TableCell>
                      <TableCell className="font-mono text-xs text-amber-700">{log.mergedId}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-600">
                        {log.keyType}: {log.normalizedKey}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600 max-w-xs truncate">{log.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Tab Content: Exact Key Evaluator */}
      {activeTab === 'evaluator' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Deal Duplicate Evaluator */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              Test Deal Duplicate Evaluation
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Deal Name</label>
                <input
                  type="text"
                  value={testDealName}
                  onChange={(e) => setTestDealName(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Stage ID</label>
                <input
                  type="text"
                  value={testDealStage}
                  onChange={(e) => setTestDealStage(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Contact Link (or leave empty for orphan)</label>
                <input
                  type="text"
                  value={testDealContact}
                  onChange={(e) => setTestDealContact(e.target.value)}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs font-mono text-slate-900"
                />
              </div>
              <Button size="sm" variant="primary" onClick={handleTestDealEval}>
                Evaluate Deal Candidate
              </Button>

              {dealEvalResult && (
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 font-mono text-xs">
                  <div>
                    Outcome:{' '}
                    <Badge variant={dealEvalResult.outcome === 'EXACT_MATCH' ? 'warning' : 'neutral'}>
                      {dealEvalResult.outcome}
                    </Badge>
                  </div>
                  <div>Requires Review: {String(dealEvalResult.requiresHumanReview)}</div>
                  {dealEvalResult.matchedId && <div>Matched Deal ID: {dealEvalResult.matchedId}</div>}
                  <div>Matching Keys: {dealEvalResult.matchingKeys.join(', ') || 'None'}</div>
                </div>
              )}
            </div>
          </div>

          {/* Quote Duplicate Evaluator */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4 shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              Test Quote Duplicate Evaluation
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Quote Number</label>
                <input
                  type="text"
                  value={testQuoteNumber}
                  onChange={(e) => setTestQuoteNumber(e.target.value)}
                  placeholder="e.g. Q-2026-001"
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-900 uppercase"
                />
              </div>
              <Button size="sm" variant="primary" onClick={handleTestQuoteEval}>
                Evaluate Quote Candidate
              </Button>

              {quoteEvalResult && (
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 font-mono text-xs">
                  <div>
                    Outcome:{' '}
                    <Badge variant={quoteEvalResult.outcome === 'EXACT_MATCH' ? 'danger' : 'success'}>
                      {quoteEvalResult.outcome}
                    </Badge>
                  </div>
                  <div>Requires Review: {String(quoteEvalResult.requiresHumanReview)}</div>
                  {quoteEvalResult.matchedId && <div>Matched Quote ID: {quoteEvalResult.matchedId}</div>}
                  <div>Matching Keys: {quoteEvalResult.matchingKeys.join(', ') || 'None'}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Review & Resolution Modal */}
      <DuplicateReviewModal
        candidate={selectedCandidate}
        isOpen={isModalOpen}
        isSubmitting={isSubmitting}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedCandidate(null);
        }}
        onResolve={handleResolveCandidate}
      />
    </div>
  );
}
