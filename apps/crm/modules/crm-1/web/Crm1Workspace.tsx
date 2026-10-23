import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@cs/ui';
import type { RoleType } from '@cs/identity';
import type {
  CRM1Company,
  CRM1ContactRead,
  CRM1ImportBatch,
  CRM1ImportBatchDetail,
  CRM1ImportReject,
  CRM1LeadRead,
} from '@clearshift/contracts/crm-1';
import {
  CRM1_API_PREFIX,
  CRM1ConsentStatusSchema,
  CRM1ImportStatusSchema,
  CRM1LeadStatusSchema,
} from '@clearshift/contracts/crm-1';
import { CRM1_ENDPOINT_ROLES, isRoleAllowed } from '../src/policies/roles.js';
import { Crm1ApiClient, Crm1ApiError } from './api/crm-1.js';
import {
  Crm1RecordEditor,
  type Crm1EditorSubmission,
  type Crm1EditorTarget,
} from './components/Crm1RecordEditor.js';
import { ErrorAlert } from './components/ErrorAlert.js';
import { ContactsListPage } from './pages/ContactsListPage.js';
import { CompaniesListPage } from './pages/CompaniesListPage.js';
import { LeadsPipelinePage } from './pages/LeadsPipelinePage.js';
import { ImportsOverviewPage } from './pages/ImportsOverviewPage.js';
import { CRM1_CONTACTS_FACETS, CRM1_COMPANIES_FACETS, CRM1_LEADS_FACETS, CRM1_IMPORTS_FACETS } from './table/facets.js';
import type { ActiveFilterPill, FilterFacet, TableFilterState } from './table/types.js';
import { Crm1Shell } from './shell/Crm1ShellView.js';

const PAGE_SIZE = 25;
const TAB_KEYS = ['contacts', 'companies', 'leads', 'imports'] as const;
type Crm1TabKey = (typeof TAB_KEYS)[number];
type Crm1ListPage = { page: number; pageSize: number; total: number; totalPages: number };

export interface Crm1WorkspaceProps {
  getAccessToken: () => string | null | Promise<string | null>;
  roles: RoleType[];
  initialTabKey?: Crm1TabKey;
}

const emptyPage: Crm1ListPage = {
  page: 1,
  pageSize: PAGE_SIZE,
  total: 0,
  totalPages: 1,
};

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('The request could not be completed. Please try again.');
}

function toHttpStatus(error: Error | null): number | undefined {
  return error instanceof Crm1ApiError ? error.status : undefined;
}

function getActivePills(filters: TableFilterState, facets: FilterFacet[]): ActiveFilterPill[] {
  return Object.entries(filters).flatMap(([key, value]) => {
    if (!value) return [];
    const facet = facets.find((candidate) => candidate.paramKey === key);
    const option = facet?.options.find((candidate) => candidate.value === value);
    return [{
      key,
      label: facet?.label ?? key,
      value,
      displayValue: option?.label ?? value,
    }];
  });
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not completed';
}

export function Crm1Workspace({
  getAccessToken,
  roles,
  initialTabKey = 'contacts',
}: Crm1WorkspaceProps) {
  const api = useMemo(
    () => new Crm1ApiClient({ getAccessToken, baseUrl: CRM1_API_PREFIX }),
    [getAccessToken]
  );
  const [activeTabKey, setActiveTabKey] = useState<Crm1TabKey>(
    initialTabKey
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<TableFilterState>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [pagination, setPagination] = useState<Crm1ListPage>(emptyPage);
  const [contacts, setContacts] = useState<CRM1ContactRead[]>([]);
  const [companies, setCompanies] = useState<CRM1Company[]>([]);
  const [leads, setLeads] = useState<CRM1LeadRead[]>([]);
  const [imports, setImports] = useState<CRM1ImportBatch[]>([]);
  const [editorTarget, setEditorTarget] = useState<Crm1EditorTarget | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batchDetail, setBatchDetail] = useState<CRM1ImportBatchDetail | null>(null);
  const [batchRejects, setBatchRejects] = useState<CRM1ImportReject[]>([]);
  const [batchRejectTotal, setBatchRejectTotal] = useState(0);
  const [batchRejectPage, setBatchRejectPage] = useState(1);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchError, setBatchError] = useState<Error | null>(null);
  const [batchRefreshKey, setBatchRefreshKey] = useState(0);
  const batchDialogRef = useRef<HTMLElement>(null);
  const previousBatchFocusRef = useRef<HTMLElement | null>(null);

  const canReadContacts = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.CONTACTS_LIST);
  const canReadCompanies = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.COMPANIES_LIST);
  const canReadLeads = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.LEADS_LIST);
  const canReadImports = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.IMPORTS_STATUS);
  const canWriteContacts = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.CONTACTS_CREATE);
  const canWriteCompanies = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.COMPANIES_CREATE);
  const canWriteLeads = isRoleAllowed(roles, CRM1_ENDPOINT_ROLES.LEADS_CREATE);
  const canReadActiveTab =
    activeTabKey === 'contacts' ? canReadContacts
      : activeTabKey === 'companies' ? canReadCompanies
        : activeTabKey === 'leads' ? canReadLeads
          : canReadImports;
  const activeReadRoles = activeTabKey === 'contacts' ? CRM1_ENDPOINT_ROLES.CONTACTS_LIST
    : activeTabKey === 'companies' ? CRM1_ENDPOINT_ROLES.COMPANIES_LIST
      : activeTabKey === 'leads' ? CRM1_ENDPOINT_ROLES.LEADS_LIST
        : CRM1_ENDPOINT_ROLES.IMPORTS_STATUS;
  const facets = activeTabKey === 'contacts' ? CRM1_CONTACTS_FACETS
    : activeTabKey === 'companies' ? CRM1_COMPANIES_FACETS
      : activeTabKey === 'leads' ? CRM1_LEADS_FACETS
        : CRM1_IMPORTS_FACETS;
  const activePills = getActivePills(filters, facets);

  useEffect(() => {
    if (!canReadActiveTab) {
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const query = { page, pageSize: PAGE_SIZE, ...(search.trim() ? { search: search.trim() } : {}) };

    void (async () => {
      try {
        if (activeTabKey === 'contacts') {
          const leadStatus = filters.leadStatus
            ? CRM1LeadStatusSchema.parse(filters.leadStatus)
            : undefined;
          const consentStatus = filters.consentStatus
            ? CRM1ConsentStatusSchema.parse(filters.consentStatus)
            : undefined;
          const unsubscribed = filters.unsubscribed === 'true' || filters.unsubscribed === 'false'
            ? filters.unsubscribed
            : undefined;
          const result = await api.listContacts({
            ...query,
            ...(leadStatus ? { leadStatus } : {}),
            ...(consentStatus ? { consentStatus } : {}),
            ...(unsubscribed ? { unsubscribed } : {}),
          }, controller.signal);
          setContacts(result.items);
          setPagination({
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
          });
        } else if (activeTabKey === 'companies') {
          const result = await api.listCompanies({
            ...query,
            ...(filters.sourceSystem ? { sourceSystem: filters.sourceSystem } : {}),
          }, controller.signal);
          setCompanies(result.items);
          setPagination({
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
          });
        } else if (activeTabKey === 'leads') {
          const status = filters.status ? CRM1LeadStatusSchema.parse(filters.status) : undefined;
          const result = await api.listLeads({
            ...query,
            ...(status ? { status } : {}),
            ...(filters.sourceSystem ? { sourceSystem: filters.sourceSystem } : {}),
          }, controller.signal);
          setLeads(result.items);
          setPagination({
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
          });
        } else {
          const status = filters.status ? CRM1ImportStatusSchema.parse(filters.status) : undefined;
          const result = await api.listImports({
            ...query,
            ...(status ? { status } : {}),
          }, controller.signal);
          setImports(result.items);
          setPagination({
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
          });
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(toError(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [activeTabKey, api, canReadActiveTab, filters, page, refreshKey, search]);

  useEffect(() => {
    if (!selectedBatchId || !canReadImports) return;
    const controller = new AbortController();
    setBatchLoading(true);
    setBatchError(null);
    void Promise.all([
      api.getImport(selectedBatchId, controller.signal),
      api.listImportRejects(selectedBatchId, { page: batchRejectPage, pageSize: PAGE_SIZE }, controller.signal),
    ]).then(([detail, rejectResult]) => {
      if (controller.signal.aborted) return;
      setBatchDetail(detail);
      setBatchRejects(rejectResult.items);
      setBatchRejectTotal(rejectResult.total);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setBatchError(toError(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setBatchLoading(false);
    });
    return () => controller.abort();
  }, [api, batchRefreshKey, batchRejectPage, canReadImports, selectedBatchId]);

  useEffect(() => {
    if (!selectedBatchId) return;
    previousBatchFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    batchDialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => previousBatchFocusRef.current?.focus();
  }, [selectedBatchId]);

  const onSearchChange = (term: string) => {
    setSearch(term);
    setPage(1);
  };

  const onFilterChange = (key: string, value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({});
    setSearch('');
    setPage(1);
  };

  const changeTab = (tabKey: string) => {
    const nextTab = TAB_KEYS.find((key) => key === tabKey);
    if (!nextTab) return;
    setActiveTabKey(nextTab);
    setPage(1);
    setSearch('');
    setFilters({});
    setError(null);
  };

  const saveRecord = async (submission: Crm1EditorSubmission) => {
    if (submission.entity === 'contact') {
      if (submission.id) await api.updateContact(submission.id, submission.payload);
      else await api.createContact(submission.payload);
    } else if (submission.entity === 'company') {
      if (submission.id) await api.updateCompany(submission.id, submission.payload);
      else await api.createCompany(submission.payload);
    } else {
      if (submission.id) await api.updateLead(submission.id, submission.payload);
      else await api.createLead(submission.payload);
    }
    setEditorTarget(null);
    setPage(1);
    setRefreshKey((current) => current + 1);
  };

  const retry = () => setRefreshKey((current) => current + 1);
  const currentRole = roles.length > 0 ? roles.join(', ') : 'No assigned role';
  const httpStatus = toHttpStatus(error);
  const pageProps = {
    isLoading: loading && canReadActiveTab,
    error,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    isAccessDenied: !canReadActiveTab,
    currentRole,
    requiredRole: activeReadRoles.join(', '),
    requiredCapability: 'module.read',
    search,
    onSearchChange,
    filters,
    onFilterChange,
    activePills,
    hasActiveFilters: activePills.length > 0 || Boolean(search.trim()),
    onRemoveFilter: (key: string) => onFilterChange(key, ''),
    onClearAllFilters: clearFilters,
    pagination,
    onPageChange: setPage,
    onRetry: retry,
  };

  return (
    <Crm1Shell
      activeTabKey={activeTabKey}
      onTabSelect={changeTab}
      visibleTabKeys={TAB_KEYS}
    >
      {activeTabKey === 'contacts' && (
        <ContactsListPage
          {...pageProps}
          data={contacts}
          isEmpty={contacts.length === 0}
          canWrite={canWriteContacts}
          onCreate={() => setEditorTarget({ entity: 'contact' })}
          onEdit={(contact) => setEditorTarget({ entity: 'contact', record: contact })}
        />
      )}
      {activeTabKey === 'companies' && (
        <CompaniesListPage
          {...pageProps}
          data={companies}
          isEmpty={companies.length === 0}
          canWrite={canWriteCompanies}
          onCreate={() => setEditorTarget({ entity: 'company' })}
          onEdit={(company) => setEditorTarget({ entity: 'company', record: company })}
        />
      )}
      {activeTabKey === 'leads' && (
        <LeadsPipelinePage
          {...pageProps}
          data={leads}
          isEmpty={leads.length === 0}
          canWrite={canWriteLeads}
          onCreate={() => setEditorTarget({ entity: 'lead' })}
          onEdit={(lead) => setEditorTarget({ entity: 'lead', record: lead })}
          onSetStatus={(lead, status) => {
            void api.updateLead(lead.id, { status }).then(retry).catch((cause: unknown) => setError(toError(cause)));
          }}
        />
      )}
      {activeTabKey === 'imports' && (
        <ImportsOverviewPage
          {...pageProps}
          data={imports}
          isEmpty={imports.length === 0}
          onViewBatch={(batchId) => {
            setBatchRejectPage(1);
            setBatchDetail(null);
            setBatchRejects([]);
            setSelectedBatchId(batchId);
          }}
        />
      )}
      {editorTarget && (
        <Crm1RecordEditor
          target={editorTarget}
          onClose={() => setEditorTarget(null)}
          onSave={saveRecord}
        />
      )}
      {selectedBatchId && canReadImports && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedBatchId(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="crm1-import-detail-title"
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
            ref={batchDialogRef}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setSelectedBatchId(null);
                return;
              }
              if (event.key !== 'Tab') return;
              const focusable = batchDialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]'
              );
              if (!focusable?.length) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="crm1-import-detail-title" className="text-lg font-semibold text-slate-900">
                  Import batch details
                </h2>
                <p className="mt-1 text-sm text-slate-600">Batch ID: {selectedBatchId}</p>
              </div>
              <Button type="button" variant="outline" onClick={() => setSelectedBatchId(null)}>
                Close
              </Button>
            </div>
            {batchLoading && <p role="status" aria-label="Loading import batch details">Loading batch details...</p>}
            {batchError && <ErrorAlert error={batchError} onRetry={() => setBatchRefreshKey((key) => key + 1)} />}
            {!batchLoading && !batchError && batchDetail && (
              <>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><dt className="font-medium">Source system</dt><dd>{batchDetail.sourceSystem}</dd></div>
                  <div><dt className="font-medium">Status</dt><dd>{batchDetail.status}</dd></div>
                  <div><dt className="font-medium">Loaded</dt><dd>{batchDetail.loadedCount}</dd></div>
                  <div><dt className="font-medium">Rejected</dt><dd>{batchDetail.rejectedCount}</dd></div>
                  <div><dt className="font-medium">Started</dt><dd>{formatDate(batchDetail.createdAt)}</dd></div>
                  <div><dt className="font-medium">Completed</dt><dd>{formatDate(batchDetail.completedAt)}</dd></div>
                </dl>
                <h3 className="mt-6 text-base font-semibold">Import receipts</h3>
                {batchDetail.receipts.length === 0 ? (
                  <p>No import receipts are recorded for this batch.</p>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {batchDetail.receipts.map((receipt) => (
                      <li key={`${receipt.sourceRow}-${receipt.entity}-${receipt.targetId}`}>
                        Row {receipt.sourceRow} ({receipt.entity}){' -> '}{receipt.targetId}
                      </li>
                    ))}
                  </ul>
                )}
                <h3 className="mt-6 text-base font-semibold">Rejected rows</h3>
                {batchRejects.length === 0 ? (
                  <p>No rejected rows on this page.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {batchRejects.map((reject) => (
                      <li key={reject.id} className="rounded border border-slate-200 p-3">
                        <p className="font-medium">Row {reject.sourceRow} - {reject.entity} - {reject.reasonCode}</p>
                        <p>{reject.message}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {batchRejectTotal > PAGE_SIZE && (
                  <nav aria-label="Rejected rows pagination" className="mt-4 flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={batchRejectPage <= 1}
                      onClick={() => setBatchRejectPage((current) => current - 1)}
                    >
                      Previous rejected rows
                    </Button>
                    <span aria-live="polite">
                      Page {batchRejectPage} of {Math.ceil(batchRejectTotal / PAGE_SIZE)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={batchRejectPage >= Math.ceil(batchRejectTotal / PAGE_SIZE)}
                      onClick={() => setBatchRejectPage((current) => current + 1)}
                    >
                      Next rejected rows
                    </Button>
                  </nav>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </Crm1Shell>
  );
}
