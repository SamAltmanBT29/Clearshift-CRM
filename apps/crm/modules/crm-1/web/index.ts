export * from './types.js';
export * from './routes.js';
export * from './auth/route-guard.js';
export * from './shell/Crm1Shell.js';
export * from './table/types.js';
export * from './table/columns.js';
export * from './table/facets.js';
export * from './table/DataTableController.js';
export * from './table/SearchFilterController.js';
export * from './components/SearchInput.js';
export * from './components/ActiveFilterPills.js';
export * from './components/FilterToolbar.js';
export * from './components/FacetedFilterSidebar.js';
export * from './components/DataTable.js';
export * from './components/TableSkeleton.js';
export * from './components/EmptyState.js';
export * from './components/ErrorAlert.js';
export * from './components/AccessDeniedView.js';
export * from './pages/ContactsListPage.js';
export * from './pages/CompaniesListPage.js';
export * from './pages/LeadsPipelinePage.js';
export * from './pages/DuplicateReviewPage.js';
export * from './pages/ImportsOverviewPage.js';
export * from './pages/CleaningAuditPage.js';
export * from './pages/MappingTemplatesPage.js';
export * from './pages/BatchLoaderPage.js';

// CRM1-04 list screen API integration
export * from './src/api/crm-1.js';
export * from './src/components/ContactsTable.js';
export * from './src/components/CompaniesTable.js';
export * from './src/components/LeadsTable.js';
export { ContactsListPage as ConnectedContactsListPage } from './src/pages/ContactsListPage.js';
export { CompaniesListPage as ConnectedCompaniesListPage } from './src/pages/CompaniesListPage.js';
export { LeadsListPage, LeadsListPage as ConnectedLeadsListPage } from './src/pages/LeadsListPage.js';

// CRM1-05 create/edit/detail workflows
export * from './src/components/forms/ConfirmModal.js';
export * from './src/components/forms/FormValidationSummary.js';
export * from './src/components/forms/ContactForm.js';
export * from './src/components/forms/CompanyForm.js';
export * from './src/components/forms/LeadForm.js';
export * from './src/pages/ContactFormPage.js';
export * from './src/pages/ContactDetailPage.js';
export * from './src/pages/CompanyFormPage.js';
export * from './src/pages/CompanyDetailPage.js';
export * from './src/pages/LeadFormPage.js';
export * from './src/pages/LeadDetailPage.js';
export * from './src/pages/ImportDetailPage.js';
