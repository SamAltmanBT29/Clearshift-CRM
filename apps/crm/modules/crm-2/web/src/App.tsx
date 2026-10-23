import React, { useState } from 'react';
import { DealsListPage } from './pages/DealsListPage.js';
import { DealDetailPage } from './pages/DealDetailPage.js';
import { DealFormPage } from './pages/DealFormPage.js';
import { QuoteFormPage } from './pages/QuoteFormPage.js';
import { DuplicateReviewPage } from './pages/DuplicateReviewPage.js';
import type { Deal } from '@clearshift/contracts';
import { Button } from '@clearshift/ui';

export type ViewState =
  | { type: 'list' }
  | { type: 'detail'; dealId: string; deal?: Deal | undefined }
  | { type: 'create-deal' }
  | { type: 'edit-deal'; dealId: string }
  | { type: 'create-quote'; dealId: string; deal?: Deal | undefined }
  | { type: 'edit-quote'; dealId: string; quoteId: string }
  | { type: 'duplicates' };

export function App() {
  const [view, setView] = useState<ViewState>({ type: 'list' });
  const [simulateDenied, setSimulateDenied] = useState(false);
  const [simulateErr, setSimulateErr] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setView({ type: 'list' })}
              className="text-xl font-bold tracking-tight text-white flex items-center gap-2 hover:opacity-90"
            >
              <span className="text-indigo-400">ClearShift</span> CRM
            </button>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-mono">
              CRM-2 V1: Deals &amp; Quotes
            </span>
          </div>

          {/* Development / Demo simulation controls */}
          <div className="flex items-center gap-2 text-xs">
            <Button
              variant={view.type === 'duplicates' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setView({ type: 'duplicates' })}
              className="text-xs bg-slate-800 border-slate-700 text-slate-200"
            >
              Duplicate Review
            </Button>
            <Button
              variant={simulateDenied ? 'danger' : 'outline'}
              size="sm"
              onClick={() => {
                setSimulateDenied((prev) => !prev);
                setSimulateErr(false);
              }}
              className="text-xs bg-slate-800 border-slate-700 text-slate-200"
            >
              {simulateDenied ? 'Restore Access' : 'Simulate 403'}
            </Button>
            <Button
              variant={simulateErr ? 'danger' : 'outline'}
              size="sm"
              onClick={() => {
                setSimulateErr((prev) => !prev);
                setSimulateDenied(false);
              }}
              className="text-xs bg-slate-800 border-slate-700 text-slate-200"
            >
              {simulateErr ? 'Clear Error' : 'Simulate 500'}
            </Button>
          </div>
        </div>
      </header>

      {/* Main View Switcher */}
      <main>
        {view.type === 'list' && (
          <DealsListPage
            simulatePermissionDenied={simulateDenied}
            simulateError={simulateErr}
            onCreateDeal={() => setView({ type: 'create-deal' })}
            onSelectDeal={(deal) => setView({ type: 'detail', dealId: deal.id, deal })}
            onViewQuotes={(deal) => setView({ type: 'detail', dealId: deal.id, deal })}
          />
        )}

        {view.type === 'detail' && (
          <DealDetailPage
            dealId={view.dealId}
            initialDeal={view.deal ?? undefined}
            onBackToList={() => setView({ type: 'list' })}
            onEditDeal={(deal) => setView({ type: 'edit-deal', dealId: deal.id })}
            onAddQuote={(deal) => setView({ type: 'create-quote', dealId: deal.id, deal })}
            onEditQuote={(quote, deal) =>
              setView({ type: 'edit-quote', dealId: deal.id, quoteId: quote.id })
            }
          />
        )}

        {view.type === 'create-deal' && (
          <DealFormPage
            onBackToList={() => setView({ type: 'list' })}
            onSuccess={(saved) => setView({ type: 'detail', dealId: saved.id, deal: saved })}
          />
        )}

        {view.type === 'edit-deal' && (
          <DealFormPage
            dealId={view.dealId}
            onBackToList={() => setView({ type: 'detail', dealId: view.dealId })}
            onSuccess={(saved) => setView({ type: 'detail', dealId: saved.id, deal: saved })}
          />
        )}

        {view.type === 'create-quote' && (
          <QuoteFormPage
            dealId={view.dealId}
            initialDeal={view.deal ?? undefined}
            onBackToDeal={() => setView({ type: 'detail', dealId: view.dealId, deal: view.deal })}
            onSuccess={() => setView({ type: 'detail', dealId: view.dealId, deal: view.deal })}
          />
        )}

        {view.type === 'edit-quote' && (
          <QuoteFormPage
            dealId={view.dealId}
            quoteId={view.quoteId}
            onBackToDeal={() => setView({ type: 'detail', dealId: view.dealId })}
            onSuccess={() => setView({ type: 'detail', dealId: view.dealId })}
          />
        )}

        {view.type === 'duplicates' && (
          <DuplicateReviewPage onBackToList={() => setView({ type: 'list' })} />
        )}
      </main>
    </div>
  );
}
export default App;
