# ClearShift CRM — CRM-3: Support Tickets and Activities

[![Module ID](https://img.shields.io/badge/Module-CRM--3-blue.svg)](file:///Users/zohashaikh/Clearshift-CRM/apps/crm/modules/crm-3)
[![Milestone](https://img.shields.io/badge/Milestone-Gate%20G4%20Release%20Candidate-green.svg)](file:///Users/zohashaikh/Clearshift-CRM/docs/governance/gate-g4-demo-rehearsal-schedule.md)
[![Storage](https://img.shields.io/badge/Storage-PostgreSQL%2018.6%20%2B%20Drizzle-orange.svg)](file:///Users/zohashaikh/Clearshift-CRM/packages/database)
[![Contract](https://img.shields.io/badge/Contract-OpenAPI%203.1-purple.svg)](file:///Users/zohashaikh/Clearshift-CRM/packages/contracts/openapi/crm-3.yaml)

## 1. Overview & Architectural Boundaries

**CRM-3 Support Tickets and Activities** is a core V1 target module within ClearShift CRM, serving as the central service desk for customer support tickets, status lifecycle transitions, append-only incident activity notes, and customer interactions.

Rather than maintaining disconnected mock screens, CRM-3 provides persisted relational storage, server-enforced RBAC, and strict compliance with the **ClearShift CRM System Design Specification (SDS) v2.0 §7.1** and **Project Plan v3.0 §7.3**.

### Core Architectural Invariants

* **V1 Target Scope**: Support tickets and append-only ticket notes.
* **Domain Invariants**:
  * **Status Lifecycle**: Restricted strictly to exact enumerations: `New`, `Open`, `Waiting`, `Solved`, `Closed`.
  * **Priority Enumeration**: Restricted strictly to exact enumerations: `Low`, `Normal`, `High`, `Urgent`.
  * **Status Transition Graph**: `New` -> `Open` -> (`Waiting` | `Solved`) -> (`Closed` | `Open`). Closed is terminal; skipping states is prohibited.
  * **Contact Association**: Ticket contact (`contactId`) must exist and resolve to a valid CRM-1 customer contact.
  * **Append-Only Activity Notes**: Notes can only be created via the API; edits and deletions are prohibited. Note author and timestamp are derived cryptographically from authenticated server claims (`request.user.sub`).
  * **Note Chronology**: Notes are returned newest-first with deterministic timestamp and UUID tie-breaker.
  * **Order Reference**: `orderRef` is an optional text reference in V1; it is **never** treated as an enforced relational foreign key into ERP systems.
  * **Out of Scope in V1**: SLAs, timeline engines, automated outbound email delivery, auto-merging, and real customer PII are strictly out of scope for V1.

---

## 2. Relational Schema & Data Model

PostgreSQL tables are defined in [`schema.ts`](./db/schema.ts) using Drizzle ORM in the `crm3` schema:

| Table Name | Entity Description | Primary Key | Key Invariants / Check Constraints |
| :--- | :--- | :--- | :--- |
| `crm3_tickets` | Support tickets | `id` (UUID) | Non-empty `subject`; `status IN ('New', 'Open', 'Waiting', 'Solved', 'Closed')`; `priority IN ('Low', 'Normal', 'High', 'Urgent')`; `contact_id` UUID |
| `crm3_notes` | Append-only ticket notes | `id` (UUID) | `ticket_id` FK to `crm3_tickets.id`; non-empty `note_text`; `author_id` VARCHAR; IMMUTABLE |
| `crm3_import_batches` | Migration batch logs | `id` (UUID) | `source_system` VARCHAR; `status IN ('pending', 'processing', 'completed', 'failed')`; `loaded_count >= 0`; `rejected_count >= 0` |
| `crm3_import_receipts` | Per-row import receipts | `id` (UUID) | `batch_id` FK; `source_row > 0`; `idempotency_key` UNIQUE; single atomic transaction with business write |

---

## 3. Public API Directory (`/api/v1/crm-tickets`)

All external endpoints enforce asymmetric EdDSA JWT verification (`clearshift-hub` issuer, `clearshift` audience) and ClearShift RBAC capabilities:

| Method | Endpoint | Allowed Roles | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/tickets` | Viewer, Editor, Analyst, Admin | List & filter support tickets (by status, priority, contact) with pagination |
| `GET` | `/tickets/:id` | Viewer, Editor, Analyst, Admin | Retrieve a single ticket by UUID |
| `POST` | `/tickets` | Editor, Migration Runner, Admin | Create a support ticket (validates contact existence) |
| `PATCH` | `/tickets/:id` | Editor, Admin | Update ticket priority, status, subject, or orderRef (enforces lifecycle transitions) |
| `GET` | `/tickets/:id/notes` | Viewer, Editor, Analyst, Admin | Retrieve notes for a ticket, returned newest-first |
| `POST` | `/notes` | Editor, Admin | Append an immutable note to a ticket (resolves author from JWT) |
| `POST` | `/tickets/:id/notes` | Editor, Admin | REST alias to append a note to a specific ticket |
| `GET` | `/imports/:batch` | Migration Runner, Admin | Query migration batch progress and reconciliation status |

---

## 4. Security, Field Protection & Audit Logging

* **Authentication**: Hub EdDSA access tokens (`@cs/identity`) verified server-side on every request. Tokens from disabled accounts (`disabled: true` or `status: "disabled"`) return HTTP `401 Unauthorized`.
* **Multi-Tenant Boundary**: Tokens carrying `tenant_id` must match `x-tenant-id` request headers; mismatches fail closed with HTTP `403 Forbidden` (`Multi-tenant boundary violation`).
* **Author Mismatch Defense**: Ticket note author is cryptographically resolved from `request.user.sub`. Attempting to submit a note with a differing `authorId` returns HTTP `403 Forbidden` (`AUTHOR_MISMATCH`).
* **Immutable Fields**: Modification of `id`, `createdAt`, `updatedAt`, `sourceSystem`, and `sourceId` via PATCH is blocked.
* **Sensitive Data Masking**:
  * Bank details masked to `XXXX-XXXX-7890` (preserving only terminal 4 digits).
  * Salary details masked to `XX,XXX` or `"salary hidden"`.
  * CSV export defense: Formula injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) are escaped with a leading single quote (`'`).
  * Log sanitization: `maskSensitiveLog()` strips credentials, tokens, and PII from application logs.
* **Append-Only Audit Trail**: `Crm3AuditService` records actor, action, timestamp, entity/batch correlation, and redacted diff/metadata.

---

## 5. Web Client Navigation & UI States

The web interface is located in [`web/`](./web/) and features:
* **Tickets Queue Grid**: Server-side faceted filtering by status, priority, and search keyword.
* **Ticket Detail & Notes Timeline**: Displays ticket metadata with chronological newest-first note history.
* **Accessible Shell (`Crm3Shell`)**: ARIA landmarks, WCAG 2.1 AA compliant color contrast, and keyboard shortcut navigation (`Alt+1..5`).
* **Resilient UI States**: Fully tested loading skeletons, empty states, network error banners, and access-denied boundaries.

---

## 6. Verification & Runbook

### Clean Checkout Test Execution

```bash
# 1. Run all CRM-3 unit, integration, and security tests
npx vitest run apps/crm/modules/crm-3

# 2. Run public contract and OpenAPI integrity tests
npx vitest run packages/contracts/tests/crm-3.test.ts

# 3. Strict TypeScript typecheck
npx tsc --noEmit

# 4. ESLint verification
npm run lint

# 5. Security & secret scan
./infra/security/secret-scan.sh
./infra/security/repo-audit.sh
```

### Deterministic Seeding & Reset

```bash
# Deterministically seed 25 synthetic tickets and 26 notes
npx tsx sample-data/crm-3/seed.ts

# Reset and re-seed clean state
npx tsx sample-data/crm-3/seed.ts --reset
```

### 5-Minute Operator Demo

Refer to [`docs/demo-scripts/crm-3-v1.md`](file:///Users/zohashaikh/Clearshift-CRM/docs/demo-scripts/crm-3-v1.md) for step-by-step verification without manual SQL edits.
