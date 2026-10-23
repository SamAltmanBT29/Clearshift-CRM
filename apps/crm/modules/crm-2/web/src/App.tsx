import React, { useState } from 'react';
import { Crm2Shell } from './shell/Crm2Shell.js';
import { DealsListPage } from './pages/DealsListPage.js';
import { DealDetailPage } from './pages/DealDetailPage.js';
import { DealFormPage } from './pages/DealFormPage.js';
import { QuoteFormPage } from './pages/QuoteFormPage.js';
import { PipelineOverviewPage } from './pages/PipelineOverviewPage.js';
import { QuotesListPage } from './pages/QuotesListPage.js';
import { CRM2_ROUTES, getRouteBreadcrumbs } from './routes.js';
import { checkRouteAuth } from './auth/route-guard.js';
import type { BreadcrumbItem, UserSession } from './types.js';
import type { Deal, Quote } from '@clearshift/contracts';
import { Roles } from '@cs/identity';
import { Capabilities } from '@cs/rbac';
import { Button, Alert } from '@clearshift/ui';

export type ViewState =
  | { type: 'deals' }
  | { type: 'pipeline' }
  | { type: 'quotes' }
  | { type: 'detail'; dealId: string; deal?: Deal | undefined }
  | { type: 'create-deal' }
  | { type: 'edit-deal'; dealId: string }
  | { type: 'create-quote'; dealId: string; deal?: Deal | undefined }
  | { type: 'edit-quote'; dealId: string; quoteId: string };

export function App() {
  const [view, setView] = useState<ViewState>({ type: 'deals' });
  const [activeTab, setActiveTab] = useState<'deals' | 'pipeline' | 'quotes'>('deals');
  const [simulateDenied, setSimulateDenied] = useState(false);
  const [simulateErr, setSimulateErr] = useState(false);
  const [simulateUnauth, setSimulateUnauth] = useState(false);

  // Active mock user session
  const userSession: UserSession | null = simulateUnauth
    ? null
    : {
        userId: 'usr-demo-001',
        roles: simulateDenied ? [Roles.VIEWER] : [Roles.EDITOR],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };

  // Derive active tab and breadcrumbs based on view state
  let currentBreadcrumbs: BreadcrumbItem[] = CRM2_ROUTES['deals'].breadcrumbs;
  if (view.type === 'detail') {
    currentBreadcrumbs = getRouteBreadcrumbs('dealDetail', {
      dealId: view.dealId,
      dealName: view.deal?.name || 'Deal Details',
    });
  } else if (view.type === 'create-deal') {
    currentBreadcrumbs = getRouteBreadcrumbs('dealCreate');
  } else if (view.type === 'edit-deal') {
    currentBreadcrumbs = getRouteBreadcrumbs('dealEdit');
  } else if (view.type === 'create-quote') {
    currentBreadcrumbs = getRouteBreadcrumbs('quoteCreate');
  } else if (view.type === 'edit-quote') {
    currentBreadcrumbs = getRouteBreadcrumbs('quoteEdit');
  } else if (view.type === 'pipeline') {
    currentBreadcrumbs = CRM2_ROUTES['pipeline'].breadcrumbs;
  } else if (view.type === 'quotes') {
    currentBreadcrumbs = CRM2_ROUTES['quotes'].breadcrumbs;
  } else {
    currentBreadcrumbs = CRM2_ROUTES['deals'].breadcrumbs;
  }

  // Handle Tab Navigation from the Shell Header
  const handleTabSelect = (tabKey: string) => {
    if (tabKey === 'deals') {
      setActiveTab('deals');
      setView({ type: 'deals' });
    } else if (tabKey === 'pipeline') {
      setActiveTab('pipeline');
      setView({ type: 'pipeline' });
    } else if (tabKey === 'quotes') {
      setActiveTab('quotes');
      setView({ type: 'quotes' });
    }
  };

  // Check route guard for mutation views
  const isMutationView =
    view.type === 'create-deal' ||
    view.type === 'edit-deal' ||
    view.type === 'create-quote' ||
    view.type === 'edit-quote';

  const authGuardResult = checkRouteAuth(
    userSession,
    `/crm-2/${activeTab}`,
    isMutationView ? Capabilities.MODULE_WRITE : Capabilities.MODULE_READ
  );

  // Action controls rendered in Shell Header
  const shellActions = (
    <div className="flex items-center gap-2 text-xs">
      <Button
        variant={simulateUnauth ? 'danger' : 'outline'}
        size="sm"
        onClick={() => {
          setSimulateUnauth((prev) => !prev);
          setSimulateDenied(false);
          setSimulateErr(false);
        }}
        className="text-xs bg-slate-800 border-slate-700 text-slate-200"
      >
        {simulateUnauth ? 'Sign In' : 'Simulate 401'}
      </Button>
      <Button
        variant={simulateDenied ? 'danger' : 'outline'}
        size="sm"
        onClick={() => {
          setSimulateDenied((prev) => !prev);
          setSimulateUnauth(false);
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
          setSimulateUnauth(false);
          setSimulateDenied(false);
        }}
        className="text-xs bg-slate-800 border-slate-700 text-slate-200"
      >
        {simulateErr ? 'Clear Error' : 'Simulate 500'}
      </Button>
    </div>
  );

  return (
    <Crm2Shell
      activeTabKey={activeTab}
      onTabSelect={handleTabSelect}
      breadcrumbs={currentBreadcrumbs}
      actions={shellActions}
    >
      {/* Route Guard Fallbacks */}
      {!authGuardResult.isAllowed ? (
        <div className="p-8 max-w-xl mx-auto space-y-4">
          <Alert
            variant="error"
            title={
              authGuardResult.reason === 'UNAUTHENTICATED'
                ? 'Authentication Required'
                : 'Access Denied (403)'
            }
          >
            {authGuardResult.reason === 'UNAUTHENTICATED'
              ? 'Your active session is unauthenticated or has expired. Redirecting to Hub login.'
              : 'You lack the required module permissions to access this screen.'}
          </Alert>
          <div className="text-center">
            <Button
              variant="primary"
              onClick={() => {
                setSimulateUnauth(false);
                setSimulateDenied(false);
              }}
            >
              Reset Session to Authorized
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Deals Tab / List View */}
          {view.type === 'deals' && (
            <DealsListPage
              simulatePermissionDenied={simulateDenied}
              simulateError={simulateErr}
              onCreateDeal={() => setView({ type: 'create-deal' })}
              onSelectDeal={(deal) => setView({ type: 'detail', dealId: deal.id, deal })}
              onViewQuotes={(deal) => setView({ type: 'detail', dealId: deal.id, deal })}
            />
          )}

          {/* Pipeline Tab View */}
          {view.type === 'pipeline' && (
            <PipelineOverviewPage
              onCreateDeal={() => setView({ type: 'create-deal' })}
              onFilterByStage={() => {
                setActiveTab('deals');
                setView({ type: 'deals' });
              }}
            />
          )}

          {/* Quotes Tab View */}
          {view.type === 'quotes' && (
            <QuotesListPage
              onSelectDeal={(dealId) => setView({ type: 'detail', dealId })}
              onEditQuote={(quote) =>
                setView({ type: 'edit-quote', dealId: quote.deal_id, quoteId: quote.id })
              }
            />
          )}

          {/* Opportunity Detail View */}
          {view.type === 'detail' && (
            <DealDetailPage
              dealId={view.dealId}
              initialDeal={view.deal ?? undefined}
              onBackToList={() => {
                setActiveTab('deals');
                setView({ type: 'deals' });
              }}
              onEditDeal={(deal) => setView({ type: 'edit-deal', dealId: deal.id })}
              onAddQuote={(deal) => setView({ type: 'create-quote', dealId: deal.id, deal })}
              onEditQuote={(quote, deal) =>
                setView({ type: 'edit-quote', dealId: deal.id, quoteId: quote.id })
              }
            />
          )}

          {/* Create Opportunity Form */}
          {view.type === 'create-deal' && (
            <DealFormPage
              onBackToList={() => {
                setActiveTab('deals');
                setView({ type: 'deals' });
              }}
              onSuccess={(saved) => setView({ type: 'detail', dealId: saved.id, deal: saved })}
            />
          )}

          {/* Edit Opportunity Form */}
          {view.type === 'edit-deal' && (
            <DealFormPage
              dealId={view.dealId}
              onBackToList={() => setView({ type: 'detail', dealId: view.dealId })}
              onSuccess={(saved) => setView({ type: 'detail', dealId: saved.id, deal: saved })}
            />
          )}

          {/* Create Quote Form */}
          {view.type === 'create-quote' && (
            <QuoteFormPage
              dealId={view.dealId}
              initialDeal={view.deal ?? undefined}
              onBackToDeal={() => setView({ type: 'detail', dealId: view.dealId, deal: view.deal })}
              onSuccess={() => setView({ type: 'detail', dealId: view.dealId, deal: view.deal })}
            />
          )}

          {/* Edit Quote Form */}
          {view.type === 'edit-quote' && (
            <QuoteFormPage
              dealId={view.dealId}
              quoteId={view.quoteId}
              onBackToDeal={() => setView({ type: 'detail', dealId: view.dealId })}
              onSuccess={() => setView({ type: 'detail', dealId: view.dealId })}
            />
          )}
        </>
      )}
    </Crm2Shell>
  );
}
export default App;
