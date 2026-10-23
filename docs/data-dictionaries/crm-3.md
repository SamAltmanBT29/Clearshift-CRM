# ClearShift CRM — Data Dictionary: CRM-3 Support Tickets and Activities

**Module ID:** `CRM-3`
**Module Name:** Support Tickets and Activities
**Owning Team:** Team `crm-support` (Group 3 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM (`crm3` schema)
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Access Pattern:** Authenticated module API `/api/v1/crm-support` with EdDSA JWTs & RBAC; Migration Kit in-process Target Adapter for atomic batch writes. Strictly zero direct cross-module SQL mutations.
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6; SDS ClearShift CRM v2.0 §4.4; V1 Standardization Plan; Issue #157 `[CRM3-24]`.

---

## 1. Entity Relationship Overview & Master-Data Ownership

CRM-3 owns the Support Tickets and Activities domain. The module maintains 4 tables in the `crm3` PostgreSQL schema:

```
┌─────────────────────────────────────────────┐
│              crm1_contacts                  │  ◀── CRM-1 owns (read via API only)
│     (Golden Identity — CRM-1 module)        │
└──────────────────────┬──────────────────────┘
                       │  contact_id (logical ref, no DB FK)
                       │  resolved via ReferenceResolver port
                       ▼
┌─────────────────────────────────────────────┐
│              crm3_tickets                   │
│  (Core Support Ticket Entity — CRM-3 owns)  │
└──────────────────────┬──────────────────────┘
                       │  1
                       │
          0..N (FK)    │ (ON DELETE CASCADE)
                       ▼
┌─────────────────────────────────────────────┐
│               crm3_notes                    │
│  (Append-only Ticket Notes — CRM-3 owns)    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│          crm3_import_batches                │
│     (Migration Execution State)             │
└──────────────────────┬──────────────────────┘
                       │  1
                       │
          0..N (FK)    │ (ON DELETE CASCADE)
                       ▼
┌─────────────────────────────────────────────┐
│          crm3_import_receipts               │
│    (Atomic Durable Import Receipts)         │
└─────────────────────────────────────────────┘
```

### Master-Data Ownership Boundaries:
* **Owner:** Team `crm-support` exclusively owns the `crm3` PostgreSQL schema and all tables within it.
* **No Direct External Writes:** The Migration Kit never writes directly to `crm3` tables; all migrations pass through the CRM-3 Target Adapter (`Crm3TargetAdapter`) which commits ticket, note, batch record and receipts atomically in a single transaction.
* **No Cross-Schema Foreign Keys:** Cross-module references (CRM-1 contact linkage) are resolved via the `ReferenceResolver` port (API call), never by direct table joins or SQL writes. ERP order references (`order_ref`) are plain text in V1 — not enforced FK constraints.
* **Note Immutability:** Notes are append-only. No update or delete API is exposed in V1.

---

## 2. Ticket Lifecycle — Status Finite State Machine

The ticket `status` field follows a strict forward-progressing lifecycle. The transition map is enforced by the service layer on all PATCH operations. Creation (API and import) may use any valid status.

```
         ┌─────────┐
  create │   New   │──────────────────────────────────┐
         └────┬────┘                                  │
              │ → Open                                │
              ▼                                       │
         ┌─────────┐                                  │
         │  Open   │◀─────────────────────┐           │
         └────┬────┘                      │           │
              │ → Waiting                 │ reopen    │
              │ → Solved                  │           │
              ▼         ▼                 │           │
       ┌─────────┐  ┌────────┐           │           │
       │ Waiting │  │ Solved │───────────┘           │
       └────┬────┘  └────┬───┘                       │
            │ → Open     │ → Closed                  │
            │ → Solved   │                            │
            ▼            ▼                            ▼
            └──────► ┌────────┐                      │
                      │ Closed │ ◀────────────────────┘
                      └────────┘ (terminal — no transitions)
```

| From \ To | New | Open | Waiting | Solved | Closed |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **New** | ⊘ | ✓ | ✗ | ✗ | ✗ |
| **Open** | ✗ | ⊘ | ✓ | ✓ | ✗ |
| **Waiting** | ✗ | ✓ | ⊘ | ✓ | ✗ |
| **Solved** | ✗ | ✓ | ✗ | ⊘ | ✓ |
| **Closed** | ✗ | ✗ | ✗ | ✗ | ⊘ |

Legend: ✓ = allowed, ✗ = rejected (422), ⊘ = idempotent no-op (200 accepted)

---

## 3. Table Specifications (Field-Level Data Dictionary)

### 3.1 Table: `crm3.crm3_tickets`

**Description:** Core support ticket records. Each ticket is linked to a validated CRM-1 contact and carries lifecycle state, priority, and an optional ERP order reference.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID generated at creation time. Never exposed in mutation payloads. | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `subject` | `text` | No | — | `crm3_tickets_subject_nonempty_check` | Brief summary or title of the ticket. Trimmed length must be > 0. No maximum length enforced in DB (API may add limits). | `"Cannot access invoice download page"` |
| `status` | `text` | No | `'New'` | `crm3_tickets_status_check`, Indexed | Ticket lifecycle status. Must be exactly one of: `New`, `Open`, `Waiting`, `Solved`, `Closed`. Status transitions enforced on PATCH (see §2). Import may use any valid status. | `"Open"` |
| `priority` | `text` | No | `'Normal'` | `crm3_tickets_priority_check`, Indexed | Urgency classification. Must be exactly one of: `Low`, `Normal`, `High`, `Urgent`. | `"High"` |
| `contact_id` | `uuid` | No | — | Indexed; no cross-schema FK constraint | Logical reference to the CRM-1 contact who opened or is linked to the ticket. Validated at write time via `ReferenceResolver`. Returns `422 VALIDATION_ERROR` / `invalid_contact_reference` if unresolvable. | `b2c3d4e5-f678-90ab-cdef-123456789012` |
| `order_ref` | `text` | Yes | `NULL` | — | Optional ERP order or invoice reference number. Plain text in V1 — not validated against ERP tables. Shown on ticket detail view if present. | `"ORD-2026-04819"` |
| `source_system` | `text` | Yes | `NULL` | `crm3_tickets_source_pair_check`, `crm3_tickets_source_key` (UNIQUE with `source_id`) | Origin legacy system identifier for migrated tickets (e.g. `"zendesk_legacy"`). Must be non-whitespace when present. Always paired with `source_id`. | `"zendesk_legacy"` |
| `source_id` | `text` | Yes | `NULL` | `crm3_tickets_source_pair_check`, `crm3_tickets_source_key` (UNIQUE with `source_system`) | Stable primary key of this record in the origin system. The pair `(source_system, source_id)` must be globally unique. Replay of an existing pair is rejected with `DUPLICATE_SOURCE_KEY`. | `"zd_ticket_8820041"` |
| `created_at` | `timestamptz` | No | `now()` | UTC; Indexed DESC | Record creation audit timestamp in UTC. Set once on initial insert; immutable after creation. | `"2026-10-23T08:00:00.000Z"` |
| `updated_at` | `timestamptz` | No | `now()` | UTC | Last modification timestamp in UTC. Updated automatically on every PATCH. Protected field — rejected if supplied in PATCH body (400). | `"2026-10-23T14:32:00.000Z"` |

**Indexes & Checks:**
* `crm3_tickets_source_key` ON `(source_system, source_id)` (UNIQUE)
* `crm3_tickets_contact_id_idx` ON `(contact_id)`
* `crm3_tickets_status_idx` ON `(status)`
* `crm3_tickets_priority_idx` ON `(priority)`
* `crm3_tickets_created_at_idx` ON `(created_at DESC)`
* Check `crm3_tickets_subject_nonempty_check`: `length(btrim(subject)) > 0`
* Check `crm3_tickets_status_check`: `status IN ('New', 'Open', 'Waiting', 'Solved', 'Closed')`
* Check `crm3_tickets_priority_check`: `priority IN ('Low', 'Normal', 'High', 'Urgent')`
* Check `crm3_tickets_source_pair_check`: `(source_system IS NULL AND source_id IS NULL) OR (source_system IS NOT NULL AND source_id IS NOT NULL AND length(btrim(source_system)) > 0 AND length(btrim(source_id)) > 0)`

---

### 3.2 Table: `crm3.crm3_notes`

**Description:** Append-only notes attached to a support ticket. Notes record the author (from authenticated context), timestamp, and text content. Displayed newest-first. Notes cannot be edited or deleted in V1.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Immutable surrogate UUID. | `c3d4e5f6-7890-ab12-cdef-456789012345` |
| `ticket_id` | `uuid` | No | — | Foreign Key → `crm3_tickets(id)` ON DELETE CASCADE; Indexed | Owning ticket reference. If the ticket is deleted, all its notes are cascade-deleted. Returns `404 NOT_FOUND` / `ticket_not_found` if ticket does not exist on note creation. | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `author_id` | `text` | No | — | `crm3_notes_author_id_nonempty_check` | Identifier of the note author. Populated from authenticated user `sub` claim (JWT). A request body supplying a different `authorId` than the authenticated user returns `403 AUTHOR_MISMATCH`. Must be non-whitespace. | `"usr_kumbharadi3106"` |
| `note_text` | `text` | No | — | `crm3_notes_note_text_nonempty_check` | The note content. Append-only — no edit or delete in V1. Must contain at least one non-whitespace character. | `"Customer confirmed the issue reproduces on Chrome 128 and Safari 17."` |
| `created_at` | `timestamptz` | No | `now()` | UTC; Composite Indexed with `ticket_id DESC` | Note creation timestamp in UTC. Used as tie-breaker for newest-first display. Immutable. | `"2026-10-23T09:15:00.000Z"` |

**Indexes & Checks:**
* `crm3_notes_ticket_id_idx` ON `(ticket_id)`
* `crm3_notes_ticket_created_at_idx` ON `(ticket_id, created_at DESC)`
* Check `crm3_notes_author_id_nonempty_check`: `length(btrim(author_id)) > 0`
* Check `crm3_notes_note_text_nonempty_check`: `length(btrim(note_text)) > 0`

---

### 3.3 Table: `crm3.crm3_import_batches`

**Description:** Tracks the lifecycle of each Migration Kit import batch submitted to CRM-3. Created as `pending` on first row load, transitions to `processing`, then `completed` or `failed`. Supports idempotent replay via `idempotency_key` + `request_hash`.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Stable batch UUID. Supplied by Migration Kit caller. | `d4e5f6a7-8901-bc23-defa-567890123456` |
| `source_system` | `text` | No | — | `crm3_import_batches_source_system_nonempty_check` | Originating legacy system identifier for this batch (e.g. `"zendesk_legacy"`). Must be non-whitespace. | `"zendesk_legacy"` |
| `status` | `text` | No | `'pending'` | `crm3_import_batches_status_check` | Batch execution lifecycle state. Allowlist: `pending`, `processing`, `completed`, `failed`. Transitions: `pending → processing → completed/failed`. | `"completed"` |
| `idempotency_key` | `text` | Yes | `NULL` | `crm3_import_batches_idempotency_key` (UNIQUE when non-null); `crm3_import_batches_idempotency_pair_check` | Caller-supplied idempotency key for the batch request. Paired with `request_hash`. Both must be non-null together. Unique constraint prevents duplicate submissions. | `"batch-key-20261023-zendesk-run-07"` |
| `request_hash` | `text` | Yes | `NULL` | `crm3_import_batches_idempotency_pair_check` | SHA-256 digest of the canonical request payload. Used to detect payload-changed replay attempts (reject with `IDEMPOTENCY_CONFLICT`). | `"a3f8c1...d92e"` |
| `loaded_count` | `integer` | No | `0` | `crm3_import_batches_loaded_count_check` (`>= 0`) | Running count of rows accepted and written to target tables. Incremented atomically per successful row. | `47` |
| `rejected_count` | `integer` | No | `0` | `crm3_import_batches_rejected_count_check` (`>= 0`) | Running count of rows rejected with a reason code. Incremented atomically per rejected row. | `3` |
| `created_at` | `timestamptz` | No | `now()` | UTC; Indexed DESC | Batch submission timestamp in UTC. | `"2026-10-23T06:00:00.000Z"` |
| `updated_at` | `timestamptz` | No | `now()` | UTC | Timestamp of most recent batch state change. | `"2026-10-23T06:04:21.000Z"` |
| `completed_at` | `timestamptz` | Yes | `NULL` | UTC | Set on transition to `completed` or `failed` terminal status. Null while batch is in progress. | `"2026-10-23T06:04:21.000Z"` |

**Indexes & Checks:**
* `crm3_import_batches_idempotency_key` ON `(idempotency_key)` (UNIQUE)
* `crm3_import_batches_created_at_idx` ON `(created_at DESC)`
* Check `crm3_import_batches_source_system_nonempty_check`: `length(btrim(source_system)) > 0`
* Check `crm3_import_batches_status_check`: `status IN ('pending', 'processing', 'completed', 'failed')`
* Check `crm3_import_batches_loaded_count_check`: `loaded_count >= 0`
* Check `crm3_import_batches_rejected_count_check`: `rejected_count >= 0`
* Check `crm3_import_batches_idempotency_pair_check`: `(idempotency_key IS NULL AND request_hash IS NULL) OR (idempotency_key IS NOT NULL AND length(btrim(idempotency_key)) > 0 AND request_hash IS NOT NULL AND length(btrim(request_hash)) > 0)`

---

### 3.4 Table: `crm3.crm3_import_receipts`

**Description:** Durable per-row import receipt records. One receipt per (batch, source row, entity type). Enables idempotent replay: the same idempotency key with the same payload returns the existing receipt; a different payload with the same key is rejected as `IDEMPOTENCY_CONFLICT`.

| Column | PostgreSQL Type | Nullable | Default | Constraints | Business Rule | Synthetic Example |
| :--- | :--- | :---: | :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` | Primary Key | Surrogate UUID for the receipt record itself. | `e5f6a7b8-9012-cd34-efab-678901234567` |
| `batch_id` | `uuid` | No | — | Foreign Key → `crm3_import_batches(id)` ON DELETE CASCADE; Composite Indexed | Owning batch reference. Cascade-deleted when batch is deleted. | `d4e5f6a7-8901-bc23-defa-567890123456` |
| `source_row` | `integer` | No | — | `crm3_import_receipts_source_row_check` (`> 0`); Composite Unique with `(batch_id, source_row, entity)` | 1-based row index in the source file. Must be a positive integer. | `12` |
| `entity` | `text` | No | — | `crm3_import_receipts_entity_check`; Composite Unique | Entity type of the created target record. Allowlist: `ticket`, `note`. | `"ticket"` |
| `source_system` | `text` | No | — | `crm3_import_receipts_source_system_nonempty_check` | Origin system tag, copied from the row payload. | `"zendesk_legacy"` |
| `source_id` | `text` | No | — | `crm3_import_receipts_source_id_nonempty_check` | Origin record identifier, copied from the row payload. | `"zd_ticket_8820041"` |
| `target_id` | `uuid` | No | — | Indexed | UUID of the created target record (`crm3_tickets.id` or `crm3_notes.id`). No cross-module FK. | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` |
| `idempotency_key` | `text` | No | — | `crm3_import_receipts_idempotency_key` (UNIQUE); `crm3_import_receipts_idempotency_key_nonempty_check` | Stable key computed as `computeIdempotencyKey(batchId, sourceRow, entity, schemaVersion)` from `@cs/core`. Globally unique. Replay with same key + same payload returns this receipt; different payload = `IDEMPOTENCY_CONFLICT`. | `"crm3:v1:d4e5f6a7:12:ticket"` |
| `created_at` | `timestamptz` | No | `now()` | UTC | Receipt creation timestamp in UTC. | `"2026-10-23T06:01:44.000Z"` |

**Indexes & Checks:**
* `crm3_import_receipts_idempotency_key` ON `(idempotency_key)` (UNIQUE)
* `crm3_import_receipts_batch_row_entity_key` ON `(batch_id, source_row, entity)` (UNIQUE)
* `crm3_import_receipts_target_id_idx` ON `(target_id)`
* Check `crm3_import_receipts_source_row_check`: `source_row > 0`
* Check `crm3_import_receipts_entity_check`: `entity IN ('ticket', 'note')`
* Check `crm3_import_receipts_source_system_nonempty_check`: `length(btrim(source_system)) > 0`
* Check `crm3_import_receipts_source_id_nonempty_check`: `length(btrim(source_id)) > 0`
* Check `crm3_import_receipts_idempotency_key_nonempty_check`: `length(btrim(idempotency_key)) > 0`

---

## 4. Cross-Module Dependency Reference

| Dependency | Type | Direction | V1 Rule |
| :--- | :--- | :--- | :--- |
| `crm1_contacts` (CRM-1) | Logical reference | CRM-3 reads via `ReferenceResolver` API | `contact_id` validated on every ticket create/edit. Returns `422` if unresolvable. No cross-schema FK. |
| ERP order / invoice | Plain text `order_ref` | CRM-3 stores as text only | Not validated in V1. Display-only on ticket detail screen. |
| Hub JWT / RBAC | Auth service | CRM-3 consumes | EdDSA JWT required for all routes. Roles: `viewer`, `editor`, `migration_runner`, `analyst`, `admin`. |
| `@cs/core` idempotency | Shared library | CRM-3 consumes | `computeIdempotencyKey()` used for import receipt keys. |

---

## 5. Out-of-Scope Fields (V2/V3 Only)

The following fields and features are **explicitly deferred** and must not be added to any V1 table or API:

| Item | Deferred To |
| :--- | :--- |
| SLA deadline / breach timestamps | V2 |
| Activity timeline (emails, calls) | V2 |
| Outbound email/SMS notifications | V3 |
| Ticket assignment (`assignee_id`) | V2 |
| Tenant/owner column | V2 |
| Company-level ticket view | V2 |
| Fuzzy duplicate matching | V3 |
| Compensating rollback saga | V3 |

---

*Document generated for Gate G1 review. Traceability: Issue #157 [CRM3-24]. Last updated: 2026-10-24.*
