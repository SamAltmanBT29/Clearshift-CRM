# ClearShift CRM — CRM-5: Migration Control Center and Reports

[![Module ID](https://img.shields.io/badge/Module-CRM--5-blue.svg)](file:///Users/dharmitsathvara/Desktop/Clearshift-CRM/apps/crm/modules/crm-5)
[![Milestone](https://img.shields.io/badge/Milestone-Gate%20G4%20Release%20Candidate-green.svg)](file:///Users/dharmitsathvara/Desktop/Clearshift-CRM/docs/governance/gate-g4-demo-rehearsal-schedule.md)
[![Storage](https://img.shields.io/badge/Storage-PostgreSQL%2018.6%20%2B%20Drizzle-orange.svg)](file:///Users/dharmitsathvara/Desktop/Clearshift-CRM/packages/database)
[![Contract](https://img.shields.io/badge/Contract-OpenAPI%203.1-purple.svg)](file:///Users/dharmitsathvara/Desktop/Clearshift-CRM/packages/contracts/src/openapi/crm-5.yaml)

## 1. Overview & Architectural Boundaries

**CRM-5 Migration Control Center and Reports** is a core V1 target module within ClearShift CRM, serving as the central observability and governance hub for migration pipelines. Rather than maintaining isolated mock screens, CRM-5 aggregates live outbox event projections from Migration Kit (`@cs/kit`) and domain modules (`crm-1` through `crm-4`).

### Core Architectural Invariants
* **Read-Only Projections**: CRM-5 consumes transactional event streams and records projection records. It **never** mutates domain tables belonging to other modules (`crm1_contacts`, `crm2_deals`, etc.).
* **Reconciliation Conservation Formula**:
  $$\text{sourceCount} = \text{loadedCount} + \text{rejectedCount} + \text{mergedCount} + \text{skippedCount} + \text{unaccountedCount}$$
  A batch is balanced and achieves terminal state `OK` **if and only if** `unaccountedCount === 0`.
* **Bounded Pagination & Deterministic Sorting**: All collection endpoints mandate query bounds (`pageSize <= 100`, default `20`) and enforce deterministic multi-column tie-breakers (e.g. `startedAt desc, id asc`).
* **Formula Injection Defense**: All CSV reporting routes sanitize text cells by prepending a single quote (`'`) to any values commencing with `=, +, -, @, \t, \r`.

---

## 2. Relational Schema & Data Model

PostgreSQL tables are defined in [`schema.ts`](./src/db/schema.ts) using Drizzle ORM:

| Table Name | Entity Description | Primary Key | Key Invariants / Check Constraints |
| :--- | :--- | :--- | :--- |
| `crm5_runs` | Migration execution events | `id` (UUID) | Non-negative record counters (`records_in >= 0`, `records_out >= 0`, `records_rejected >= 0`); valid status (`pending`, `running`, `completed`, `failed`, `halted`) |
| `crm5_scores` | 5-dimension quality score cards | `id` (UUID) | Normalized rates (`0.0000 <= dim <= 1.0000`); composite score = $100 \times \frac{\text{comp} + \text{val} + (1-\text{dup}) + (1-\text{rej}) + \text{link}}{5}$ |
| `crm5_rejects` | Row-level validation failures | `id` (UUID) | `row_index >= 1`; non-empty `error_code` and `reason`; privacy-safe `payload_hash` |
| `crm5_reconciliation_reports` | Row conservation balance sheets | `id` (UUID) | Strict conservation invariant; status `OK` iff `unaccounted_count = 0` |

---

## 3. Public API Directory (`/api/v1/crm-control`)

All protected endpoints enforce Bearer JWT authentication and ClearShift RBAC capabilities:

| Method | Endpoint | Required Capability | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | *Public* | Liveness and health check |
| `GET` | `/runs` | `control:read` | Paginated migration run projections with filters (`module`, `status`, `batchId`) |
| `GET` | `/scores` | `control:read` | Migration data quality scorecards and system average quality score |
| `GET` | `/rejects` | `control:read` | Paginated row-level rejection inspection log |
| `GET` | `/reconciliation/:batch` | `control:read` | Conservation balance sheet for a batch |
| `GET` | `/runs/export` | `control:export` | Formula-safe RFC 4180 CSV export of migration runs |
| `GET` | `/rejects/export` | `control:export` | Formula-safe RFC 4180 CSV export of rejection logs |
| `POST` | `/import/row` | `control:admin` | Migration Kit module adapter target loader (idempotent row insertion) |

---

## 4. Frontend Web Architecture

Located in [`web/`](./web/), the frontend exposes a full suite of accessible UI components:

* **Shell**: [`Crm5Shell.tsx`](./web/shell/Crm5Shell.tsx) with role-aware header and sub-navigation.
* **Paginated Tables**: [`DataTable.tsx`](./web/components/DataTable.tsx) managed by [`DataTableController.ts`](./web/table/DataTableController.ts).
* **Faceted Filtering & Search**:
  * [`FilterToolbar.tsx`](./web/components/FilterToolbar.tsx)
  * [`SearchInput.tsx`](./web/components/SearchInput.tsx) (300ms debounce protocol)
  * [`FacetedFilterSidebar.tsx`](./web/components/FacetedFilterSidebar.tsx)
  * [`ActiveFilterPills.tsx`](./web/components/ActiveFilterPills.tsx)
* **Resilient UI States**:
  * [`TableSkeleton.tsx`](./web/components/TableSkeleton.tsx) (WAI-ARIA `aria-busy="true"`)
  * [`EmptyState.tsx`](./web/components/EmptyState.tsx) (Zero-data and filtered empty states with reset CTA)
  * [`ErrorAlert.tsx`](./web/components/ErrorAlert.tsx) (Sanitizes stack traces; includes keyboard-accessible retry)
  * [`AccessDeniedView.tsx`](./web/components/AccessDeniedView.tsx) (Displays 403 Forbidden with security context)

---

## 5. Developer Runbook & Verification Commands

### Deterministic Seed & Reset
```bash
# Seed synthetic test fixtures (100 dirty rows + scorecards + reconciliation)
npx tsx sample-data/crm-5/seed.ts

# Reset and purge CRM-5 state
npx tsx sample-data/crm-5/seed.ts --reset
```

### Automated Test Suites
```bash
# Run all CRM-5 backend, domain, contract, and web tests
npx vitest run apps/crm/modules/crm-5

# Run OpenAPI contract conformance suite
npx vitest run apps/crm/modules/crm-5/tests/contracts/openapi.test.ts

# Run Web UI component integration suite
npx vitest run apps/crm/modules/crm-5/tests/web/components.test.tsx
```

### Monorepo Quality Gates
```bash
# TypeScript typechecking
npm run typecheck

# ESLint verification
npm run lint

# Security & secret audit
npm run security:check

# Frontend accessibility & design validation
npm run validate:frontend

# PMO-12 Governance & recovery verification
npm run governance:verify
```
