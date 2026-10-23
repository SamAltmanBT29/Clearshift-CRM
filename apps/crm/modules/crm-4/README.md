# ClearShift CRM — CRM-4: Marketing Lists and Campaign History

[![Module ID](https://img.shields.io/badge/Module-CRM--4-blue.svg)](file:///Users/kartikwagh/CRM/Clearshift-CRM/apps/crm/modules/crm-4)
[![Milestone](https://img.shields.io/badge/Milestone-Gate%20G4%20Release%20Candidate-green.svg)](file:///Users/kartikwagh/CRM/Clearshift-CRM/docs/governance/gate-g4-demo-rehearsal-schedule.md)
[![Storage](https://img.shields.io/badge/Storage-PostgreSQL%2018.6%20%2B%20Drizzle-orange.svg)](file:///Users/kartikwagh/CRM/Clearshift-CRM/packages/database)
[![Contract](https://img.shields.io/badge/Contract-OpenAPI%203.1-purple.svg)](file:///Users/kartikwagh/CRM/Clearshift-CRM/packages/contracts/openapi/crm-4.yaml)

## 1. Overview & Architectural Boundaries

**CRM-4 Marketing Lists and Campaign History** is a core V1 target module within ClearShift CRM, serving as the central store for marketing segmentation lists, historical marketing campaigns, participant engagement logs, and contact consent management.

Rather than maintaining isolated mock screens, CRM-4 provides persisted relational storage, server-enforced RBAC, and strict compliance with global privacy policies.

### Core Architectural Invariants

* **History Recording Only (V1 Scope)**: Campaign dispatch, email/SMS SMTP delivery, message queues, and realtime open/click tracking are strictly **out of scope in V1**. CRM-4 records and queries history and consent data.
* **BR-CRM4-01 Monotonic Opt-Out**: Opt-out is strictly monotonic. Once a contact is recorded as `unsubscribed`, neither migration batch loads, bulk jobs, nor UI user interactions may revert that status to `subscribed`.
* **Immutable Campaign List Association**: Campaigns belong to one marketing list throughout their lifecycle (`listId` is immutable after creation).
* **Member Status Allowlist**: Campaign member statuses are restricted strictly to `sent`, `opened`, and `clicked`. Arbitrary statuses are rejected with HTTP 400.
* **Action-Time Consent Verification**: Member additions and CSV exports verify the current contact consent status in real time.
* **Formula Injection Defense**: All exported CSV files escape cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` by prepending a single quote (`'`).

---

## 2. Relational Schema & Data Model

PostgreSQL tables are defined in [`schema.ts`](./db/schema.ts) using Drizzle ORM in the `crm4` schema:

| Table Name | Entity Description | Primary Key | Key Invariants / Check Constraints |
| :--- | :--- | :--- | :--- |
| `crm4_lists` | Marketing segment lists | `id` (UUID) | Non-empty `name`; non-negative `campaign_count >= 0` and `member_count >= 0` |
| `crm4_campaigns` | Marketing campaign history | `id` (UUID) | Non-empty `name`; valid date; `list_id` FK to `crm4_lists.id` (IMMUTABLE); non-negative `member_count` |
| `crm4_members` | Campaign participants | `id` (UUID) | Unique (`campaign_id`, `contact_id`); status in `('sent', 'opened', 'clicked')`; `unsubscribed` flag |
| `crm4_consents` | Contact consent state | `id` (UUID) | Unique `contact_id`; status in `('subscribed', 'unsubscribed')`; non-empty `source`; BR-CRM4-01 monotonic opt-out |

---

## 3. Public API Directory (`/api/v1/crm-marketing`)

All protected endpoints enforce asymmetric EdDSA JWT verification (`clearshift-hub` issuer, `clearshift` audience) and ClearShift RBAC capabilities:

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/lists` | Viewer, Editor, Analyst, Admin | Paginated marketing lists with search filter |
| `POST` | `/lists` | Editor, Admin | Create a marketing list |
| `PATCH` | `/lists/:id` | Editor, Admin | Update marketing list name or description |
| `GET` | `/campaigns` | Viewer, Editor, Analyst, Admin | Paginated campaigns with optional `listId` filter |
| `POST` | `/campaigns` | Editor, Admin | Create a campaign linked to a list |
| `PATCH` | `/campaigns/:id` | Editor, Admin | Update campaign name/date (listId mutation blocked with 403) |
| `GET` | `/campaigns/:id/members` | Viewer, Editor, Analyst, Admin | Paginated campaign members with status filter |
| `POST` | `/campaigns/:id/members` | Editor, Admin | Record campaign participant with action-time consent check |
| `GET` | `/consents/:contact` | Viewer, Editor, Analyst, Admin | Retrieve consent status for a CRM-1 contact |
| `POST` | `/consents` | Editor, Admin | Record/update consent (enforces BR-CRM4-01 monotonic opt-out) |
| `GET` | `/campaigns/:id/export` | Viewer, Editor, Analyst, Admin | Export campaign participants as formula-safe CSV |

---

## 4. Frontend Web Architecture

Located in [`web/`](./web/), the frontend exposes a full suite of accessible, role-aware UI components:

* **Shell**: [`Crm4Shell.tsx`](./web/shell/Crm4Shell.tsx) with accessible tablist navigation, keyboard arrow controls, and Skip Links.
* **Forms & Modals**:
  * [`ListForm.tsx`](./web/src/components/forms/ListForm.tsx): Create and edit marketing lists with dirty detection.
  * [`CampaignForm.tsx`](./web/src/components/forms/CampaignForm.tsx): Campaign creation and edit with immutable `listId` badge.
  * [`ConsentForm.tsx`](./web/src/components/forms/ConsentForm.tsx): Contact consent management. **Disables the `subscribed` radio option when contact is already unsubscribed (BR-CRM4-01)**.
  * [`ConfirmModal.tsx`](./web/src/components/forms/ConfirmModal.tsx): Accessible WAI-ARIA modal dialog for uncommitted dirty form cancellation.
* **Pages**:
  * [`ListFormPage.tsx`](./web/src/pages/ListFormPage.tsx): Dedicated list create/edit screen.
  * [`CampaignFormPage.tsx`](./web/src/pages/CampaignFormPage.tsx): Dedicated campaign create/edit screen.
  * [`CampaignDetailPage.tsx`](./web/src/pages/CampaignDetailPage.tsx): Campaign metrics, member sub-table, and add-member drawer.
  * [`ConsentFormPage.tsx`](./web/src/pages/ConsentFormPage.tsx): Dedicated contact consent audit and update screen.

---

## 5. Developer Runbook & Verification Commands

### Deterministic Seed & Reset
```bash
# Seed 10 synthetic marketing lists, 10 campaigns, 5 members, and 5 consents
npx tsx sample-data/crm-4/seed.ts

# Reset and purge CRM-4 state
npx tsx sample-data/crm-4/seed.ts --reset
```

### Automated Test Suites
```bash
# Run all CRM-4 backend, domain, security, contract, and web tests
npm test -- apps/crm/modules/crm-4

# Run Domain Invariants and BR-CRM4-01 suite
npm test -- apps/crm/modules/crm-4/tests/domain/invariants.test.ts

# Run Fastify API injection test suite
npm test -- apps/crm/modules/crm-4/tests/api/routes.test.ts

# Run OpenAPI 3.1 contract conformance test
npm test -- apps/crm/modules/crm-4/tests/contracts/openapi.test.ts

# Run Drizzle schema constraints test
npm test -- apps/crm/modules/crm-4/tests/db/schema.test.ts

# Run Dirty Data Pack reconciliation test
npm test -- apps/crm/modules/crm-4/tests/fixtures/dirty-pack.test.ts
```

### Monorepo Quality Gates
```bash
# TypeScript strict typechecking
npm run typecheck

# ESLint verification
npm run lint
```
