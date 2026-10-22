# ClearShift Central Role & Field-Level Authorization Matrix

**Identifier:** `[PLT-06]`  
**Status:** Approved Architectural Baseline  
**Classification:** Security / RBAC  
**Target Gate:** Gate G2  
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4/§7.1; SDS ClearShift Migration Kit v2.0 §4/§7.1; Master Architecture Spec Baseline 1.0-A §4.2.

---

## 1. Executive Summary

ClearShift enforces a unified, server-side **Default Deny** role-based and field-level access control model across all modules (CRM-1 through CRM-5, ERP-1 through ERP-5), Migration Kit, and Hub Identity services.

### Non-Negotiable Core Principles
1. **Default Deny**: Every endpoint must have explicit allowed roles or be explicitly marked with `@public` / `isPublic: true`. Any route missing an explicit policy is denied by default (`403 Forbidden`).
2. **Server-Side Authority**: Hidden or disabled UI buttons are **never** treated as security boundaries. All authorization checks and field masking occur server-side prior to query execution, mutation, JSON serialization, and CSV export.
3. **Fixed Role Taxonomy**: Exactly 5 standard roles exist in V1 (`viewer`, `editor`, `migration_runner`, `analyst`, `admin`). Custom or fine-grained per-tenant policies are out of scope for V1.
4. **Field-Level Security (FLS) & Masking**:
   - **Credentials & Secrets**: Redacted (`[REDACTED]`) for **all** roles, including Admin.
   - **Bank Details & Government Identifiers**: Masked for **all** roles, including Admin (`XXXX-XXXX-7890` and `***-**-XXXX`). Admin rights do not bypass bank or government ID masking.
   - **Salary & Compensation**: Masked for Viewer and unprivileged roles (`XX,XXX` or `salary hidden`). Visible to Admin exclusively under approved HR policy.
5. **Separation of Duties**: The `migration_runner` technical role executes batch imports, opening balance loads, and payroll total loads, but is strictly **prohibited** from approving its own merge or skip decisions.

---

## 2. Standard Role Definitions

| Role | System Identifier | Scope & Permitted Actions | Prohibitions & Invariants |
|---|---|---|---|
| **Viewer** | `viewer` | Read-only access to standard business records and dashboards where permitted by module SDS. | Cannot create, mutate, patch, delete, bulk load, or administer. Salary is always masked. |
| **Editor** | `editor` | Full CRUD read and write/patch access to domain business records. Review duplicate candidates and approve/reject merge/skip proposals. | Cannot run bulk load operations. Cannot view unmasked bank details or secrets. |
| **Migration Runner** | `migration_runner` | Execute the 7-step migration pipeline (Extract, Clean, Map, Dry-run, Load) and ERP bulk opening balance / payroll endpoints. | Technical role only. Cannot edit domain records directly. **Strictly prohibited from self-approving merge/skip decisions.** |
| **Analyst** | `analyst` | Read quality/control-center reports, CRM-5 analytics dashboards, trial-balance reports, and general ledger reconciliations. | Read-only. Cannot create, edit, patch, or delete records. Cannot execute migration steps. |
| **Admin** | `admin` | Full administrative route rights across Hub Identity, system settings, and service token management. | **Cannot bypass field-level masking** for bank details or government identifiers. Cannot read credentials or private keys. |

---

## 3. Central Route & Capability Authorization Matrix

The table below defines the authoritative authorization matrix for all route groups in the ClearShift modular monolith:

| Route Path | HTTP Method | Route Group / Capability | Allowed Roles | Description & Boundary Rules |
|---|---|---|---|---|
| `/api/v1/hub/auth/login` | `POST` | `hub.auth` | **Public** | Authenticates local users via argon2id; returns EdDSA JWT. |
| `/api/v1/hub/.well-known/jwks.json` | `GET` | `hub.jwks` | **Public** | Public key set for token verification across services. |
| `/api/v1/hub/health/live` | `GET` | `hub.health` | **Public** | Liveness probe (process operational). |
| `/api/v1/hub/health/ready` | `GET` | `hub.health` | **Public** | Readiness probe (PostgreSQL/Redis connectivity). |
| `/api/v1/hub/id-map` | `POST` / `GET` | `hub.id_map` | `viewer`, `editor`, `migration_runner`, `admin` | Idempotent Golden ID upsert and lookup by source system/ID. |
| `/api/v1/hub/id-map/evidence` | `GET` | `hub.id_map` | `viewer`, `editor`, `analyst`, `admin` | Read Golden ID resolution evidence graph. |
| `/api/v1/hub/id-map/merge` | `POST` | `hub.admin` | `admin` | Authoritative human approval for Golden ID merge. |
| `/api/v1/hub/admin/service-tokens` | `POST` | `hub.admin` | `admin` | Issue scoped service account tokens for workers/CLI. |
| `/api/v1/hub/admin/audit-logs` | `GET` | `hub.admin` | `admin` | Read append-only audit trail entries. |
| `/api/v1/crm-contacts/contacts` | `GET` | `crm.contacts.read` | `viewer`, `editor`, `analyst`, `admin` | Paginated contacts list. Field masking applied. |
| `/api/v1/crm-contacts/contacts/:id` | `GET` | `crm.contacts.read` | `viewer`, `editor`, `analyst`, `admin` | Contact details. Field masking applied. |
| `/api/v1/crm-contacts/contacts` | `POST` | `crm.contacts.write` | `editor`, `admin` | Create new contact record. |
| `/api/v1/crm-contacts/contacts/:id` | `PATCH` | `crm.contacts.write` | `editor`, `admin` | Update contact (inherits Editor role). |
| `/api/v1/crm-contacts/companies` | `GET` | `crm.companies.read` | `viewer`, `editor`, `admin` | Paginated companies list. |
| `/api/v1/crm-contacts/companies` | `POST` / `PATCH` | `crm.companies.write` | `editor`, `admin` | Create or update company record. |
| `/api/v1/crm-contacts/leads` | `GET` | `crm.leads.read` | `viewer`, `editor`, `admin` | Paginated leads pipeline list. |
| `/api/v1/crm-contacts/leads` | `POST` / `PATCH` | `crm.leads.write` | `editor`, `admin` | Create or update lead record. |
| `/api/v1/crm-contacts/reports` | `GET` | `crm.reports.read` | `viewer`, `analyst`, `admin` | CRM-5 profiling and quality score reports. |
| `/api/v1/crm-contacts/imports` | `POST` | `kit.bulk_load` | `migration_runner` | CRM-1 direct bulk load ingestion (Migration Runner only). |
| `/api/v1/crm-contacts/imports/:batch` | `GET` | `kit.pipeline.read` | `viewer`, `analyst`, `admin` | Batch execution status and receipts. |
| `/api/v1/crm-contacts/imports/:batch/rejects` | `GET` | `kit.pipeline.read` | `viewer`, `analyst`, `admin` | Paginated rejected rows and audit reasons. |
| `/api/v1/erp-inventory/products` | `GET` | `erp.products.read` | `viewer`, `editor`, `admin` | Read products and stock balances. |
| `/api/v1/erp-inventory/products` | `POST` / `PATCH` | `erp.products.write` | `editor`, `admin` | Product catalog maintenance. |
| `/api/v1/erp-finance/vendors` | `GET` | `erp.vendors.read` | `viewer`, `editor`, `admin` | Read vendor records and status. |
| `/api/v1/erp-finance/vendors` | `POST` / `PATCH` | `erp.vendors.write` | `editor`, `admin` | Create or update vendor records. |
| `/api/v1/erp-finance/invoices` | `GET` | `erp.invoices.read` | `viewer`, `editor`, `admin` | Read customer invoices and billing status. |
| `/api/v1/erp-finance/invoices` | `POST` / `PATCH` | `erp.invoices.write` | `editor`, `admin` | Create or update customer invoices. |
| `/api/v1/erp-finance/journal` | `GET` | `erp.finance.reports` | `analyst`, `viewer`, `admin` | Read posted journal entries. |
| `/api/v1/erp-finance/journal` | `POST` | `erp.finance.journal` | `editor`, `admin` | Post balanced journal entries (ERP-4). |
| `/api/v1/erp-finance/trial-balance` | `GET` | `erp.finance.reports` | `analyst`, `viewer`, `admin` | Read trial-balance and general ledger reports. |
| `/api/v1/erp-finance/opening-balances/bulk` | `POST` | `kit.bulk_load` | `migration_runner` | Bulk load opening balances (Migration Runner only). |
| `/api/v1/erp-hr/employees` | `GET` | `erp.hr.employees.read` | `viewer`, `editor`, `admin` | Employee directory. Field masking applied. |
| `/api/v1/erp-hr/employees` | `POST` / `PATCH` | `erp.hr.employees.write` | `editor`, `admin` | Create or update employee records. |
| `/api/v1/erp-hr/departments` | `GET` | `erp.hr.employees.read` | `viewer`, `editor`, `admin` | List HR departments and structures. |
| `/api/v1/erp-hr/payroll-totals/bulk` | `POST` | `kit.bulk_load` | `migration_runner` | Bulk load payroll totals (Migration Runner only). |
| `/api/v1/migration-kit/batches` | `GET` | `kit.pipeline.read` | `viewer`, `editor`, `migration_runner`, `analyst`, `admin` | List batches and state ledgers. |
| `/api/v1/migration-kit/batches` | `POST` | `kit.pipeline.run` | `migration_runner`, `admin` | Upload source file and create batch. |
| `/api/v1/migration-kit/batches/:id/profile` | `POST` | `kit.pipeline.run` | `migration_runner`, `admin` | Trigger Step 2 profiling. |
| `/api/v1/migration-kit/batches/:id/clean` | `POST` | `kit.pipeline.run` | `migration_runner`, `admin` | Trigger Step 3 cleaning rule pipeline. |
| `/api/v1/migration-kit/batches/:id/map` | `GET` / `POST` | `kit.review` | `editor`, `admin` | Configure field mapping templates. |
| `/api/v1/migration-kit/batches/:id/dry-run` | `POST` | `kit.pipeline.run` | `migration_runner`, `admin` | Execute dry run without database mutation. |
| `/api/v1/migration-kit/batches/:id/load` | `POST` | `kit.bulk_load` | `migration_runner` | Execute Step 5 target bulk load (Migration Runner only). |
| `/api/v1/migration-kit/batches/:id/reconcile` | `GET` | `kit.pipeline.read` | `viewer`, `analyst`, `admin` | Verify 4-term reconciliation equation. |
| `/api/v1/migration-kit/batches/:id/merge` | `POST` | `kit.merge_skip_approval` | `editor`, `admin` | Approve candidate duplicate merge (**Runner strictly denied**). |
| `/api/v1/migration-kit/batches/:id/skip` | `POST` | `kit.merge_skip_approval` | `editor`, `admin` | Approve skip record candidate (**Runner strictly denied**). |
| *Unregistered route* | `ALL` | *none* | **None** | **Default Deny**: returns `403 Forbidden` (`DEFAULT_DENY`). |

---

## 4. Field-Level Masking & Redaction Specification

Field-level restrictions are executed server-side prior to JSON serialization and CSV export:

| Field Category | Key Patterns | Masking Rule / Replacement | Viewer | Editor | Runner | Analyst | Admin |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| **Credentials & Secrets** | `password`, `token`, `secret`, `argon2hash`, `apiKey`, `privateKey`, `jwt` | Always replace with `[REDACTED]`. Never serialized or exported. | Redacted | Redacted | Redacted | Redacted | **Redacted** |
| **Bank Details** | `bankAccount`, `accountNumber`, `iban`, `routingNumber`, `swift` | Mask to `XXXX-XXXX-7890` (preserving only terminal 4 digits). Shorter values masked as `XXXX`. | Masked | Masked | Masked | Masked | **Masked** |
| **Government Identifiers** | `ssn`, `taxId`, `nationalId`, `aadhaar`, `pan` | Mask to `***-**-XXXX` (preserving terminal 4 digits) or `[REDACTED_ID]`. | Masked | Masked | Masked | Masked | **Masked** |
| **Salary & Compensation** | `salary`, `baseSalary`, `compensation`, `wage`, `hourlyRate` | Mask to `XX,XXX` or `'salary hidden'`. Visible only to Admin under approved HR policy. | Masked | Masked | Masked | Masked | **Visible** *(HR Policy)* |

---

## 5. CSV Export Sanitization & Formula Protection

All CSV and tabular data exports are processed through `exportCsvWithFieldMasking`:
1. **Server-Side Field Masking**: All records undergo field-level redaction for the caller's role before CSV formatting occurs.
2. **Spreadsheet Formula Neutralization (CWE-1236)**: Any cell starting with `= `, `+ `, `- `, `@ `, `\t`, or `\r` after optional whitespace is prepended with a single quote (`'`), neutralizing formula execution in Excel, LibreOffice Calc, and Google Sheets.
3. **No Credential/PII Leakage**: Application tokens, hashed passwords, unmasked bank details, and unmasked government IDs are guaranteed absent from CSV output.

---

## 6. Standard Error Envelopes & Deny Codes

All authorization failures emit the standard ClearShift error envelope (`{ code, message, details, correlation_id }`):

- **401 Unauthorized**:
  - `UNAUTHENTICATED`: Missing, expired, malformed, or invalid Authorization Bearer header.
- **403 Forbidden**:
  - `FORBIDDEN`: User does not possess the required role for the requested endpoint.
  - `DEFAULT_DENY`: Route has no explicit allowed roles policy.
  - `SELF_APPROVAL_FORBIDDEN`: Migration Runner attempted to approve its own merge or skip decision.

### Example 403 Forbidden Error Response:
```json
{
  "code": "FORBIDDEN",
  "message": "Access denied. Allowed roles for this endpoint: [editor, admin]",
  "details": [],
  "correlation_id": "corr-1729618000000"
}
```

---

## 7. Audit Trail Integration

All privileged authorization actions, administrative token grants, human merge decisions, and access denials are recorded in the append-only audit trail (`packages/core/src/audit`) containing:
- `actor`: Authenticated User UUID (`sub`) and role array.
- `action`: Specific operation verb (e.g. `authz.denied`, `merge.decided`, `export.generated`).
- `timestamp`: ISO-8601 UTC timestamp.
- `correlation_id`: Request correlation ID.
- `result`: Outcome (`success` or `failure`).
- `metadata`: Pre-redacted context (no passwords, raw PII, or unmasked credentials).

---

## 8. Verification & Compliance Evidence

- Automated unit and integration test suite: `packages/core/tests/permissions.test.ts` (37 tests, 100% pass rate).
- Table-driven enumeration testing all 5 roles against every route group.
- Static type checking: `tsc --noEmit` clean with zero errors across monorepo.
- Code style and linting: `eslint .` clean with zero errors.
- Security and fixture audit: `./infra/security/repo-audit.sh` passing with zero cloud uploaders and compliant synthetic fixtures.
