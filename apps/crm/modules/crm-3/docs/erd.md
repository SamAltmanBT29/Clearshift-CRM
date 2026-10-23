# CRM-3 Support Tickets and Activities — Entity Relationship Diagram

**Module:** CRM-3 Support Tickets and Activities
**Schema:** `crm3` (PostgreSQL 18.6)
**Version:** V1
**Traceability:** SDS ClearShift CRM v2.0 §4.4; Issue #157 [CRM3-24]

---

## 1. Entity Relationship Diagram

```
╔══════════════════════════════════════════════════════════════╗
║              EXTERNAL MODULE BOUNDARY — CRM-1               ║
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │                   crm1_contacts                       │   ║
║  │  PK  id         : uuid  NOT NULL                      │   ║
║  │      first_name : text  NOT NULL                      │   ║
║  │      last_name  : text  NOT NULL                      │   ║
║  │      email      : text  NULL                          │   ║
║  │      golden_id  : text  NOT NULL  (UNIQUE)            │   ║
║  │      ...                                              │   ║
║  └─────────────────────────┬────────────────────────────┘   ║
║                            │                                 ║
╚════════════════════════════│════════════════════════════════╝
                             │  contact_id (logical reference)
                             │  Validated via ReferenceResolver API
                             │  NO cross-schema FK in PostgreSQL
                             │  Returns 422 if unresolvable
                             │
╔════════════════════════════│════════════════════════════════╗
║              CRM-3 MODULE BOUNDARY (crm3 schema)            ║
║                            │                                 ║
║                            ▼  0..N tickets per contact       ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │                   crm3_tickets                        │   ║
║  │                                                       │   ║
║  │  PK  id           : uuid        NOT NULL              │   ║
║  │      subject      : text        NOT NULL              │   ║
║  │      status       : text        NOT NULL  DEF 'New'   │   ║
║  │                     CHECK IN('New','Open','Waiting',  │   ║
║  │                              'Solved','Closed')       │   ║
║  │      priority     : text        NOT NULL  DEF 'Normal'│   ║
║  │                     CHECK IN('Low','Normal','High',   │   ║
║  │                              'Urgent')                │   ║
║  │  FK→ contact_id   : uuid        NOT NULL  (logical)   │   ║
║  │      order_ref    : text        NULL                  │   ║
║  │      source_system: text        NULL                  │   ║
║  │      source_id    : text        NULL                  │   ║
║  │                     UNIQUE(source_system, source_id)  │   ║
║  │      created_at   : timestamptz NOT NULL  DEF now()   │   ║
║  │      updated_at   : timestamptz NOT NULL  DEF now()   │   ║
║  │                                                       │   ║
║  │  Indexes:                                             │   ║
║  │    · crm3_tickets_source_key        UNIQUE(ss, sid)   │   ║
║  │    · crm3_tickets_contact_id_idx    (contact_id)      │   ║
║  │    · crm3_tickets_status_idx        (status)          │   ║
║  │    · crm3_tickets_priority_idx      (priority)        │   ║
║  │    · crm3_tickets_created_at_idx    (created_at DESC) │   ║
║  └──────────────────────┬──────────────────────────────┘   ║
║                         │  1                                 ║
║                         │                                    ║
║            0..N (FK)    │  ON DELETE CASCADE                 ║
║                         ▼                                    ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │                   crm3_notes                          │   ║
║  │                                                       │   ║
║  │  PK   id        : uuid        NOT NULL                │   ║
║  │  FK→  ticket_id : uuid        NOT NULL  CASCADE       │   ║
║  │       author_id : text        NOT NULL                │   ║
║  │       note_text : text        NOT NULL                │   ║
║  │       created_at: timestamptz NOT NULL  DEF now()     │   ║
║  │                                                       │   ║
║  │  Indexes:                                             │   ║
║  │    · crm3_notes_ticket_id_idx          (ticket_id)    │   ║
║  │    · crm3_notes_ticket_created_at_idx  (tid, ca DESC) │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║                                                              ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │              crm3_import_batches                      │   ║
║  │                                                       │   ║
║  │  PK  id              : uuid     NOT NULL              │   ║
║  │      source_system   : text     NOT NULL              │   ║
║  │      status          : text     NOT NULL  DEF 'pending'│  ║
║  │                        CHECK IN('pending','processing',│  ║
║  │                                 'completed','failed') │   ║
║  │      idempotency_key : text     NULL      UNIQUE      │   ║
║  │      request_hash    : text     NULL                  │   ║
║  │      loaded_count    : integer  NOT NULL  DEF 0       │   ║
║  │      rejected_count  : integer  NOT NULL  DEF 0       │   ║
║  │      created_at      : timestamptz NOT NULL DEF now() │   ║
║  │      updated_at      : timestamptz NOT NULL DEF now() │   ║
║  │      completed_at    : timestamptz NULL               │   ║
║  │                                                       │   ║
║  │  Indexes:                                             │   ║
║  │    · crm3_import_batches_idempotency_key  UNIQUE(ik)  │   ║
║  │    · crm3_import_batches_created_at_idx   (ca DESC)   │   ║
║  └──────────────────────┬──────────────────────────────┘   ║
║                         │  1                                 ║
║                         │                                    ║
║            0..N (FK)    │  ON DELETE CASCADE                 ║
║                         ▼                                    ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │              crm3_import_receipts                     │   ║
║  │                                                       │   ║
║  │  PK   id              : uuid     NOT NULL             │   ║
║  │  FK→  batch_id         : uuid     NOT NULL  CASCADE   │   ║
║  │       source_row       : integer  NOT NULL  (> 0)     │   ║
║  │       entity           : text     NOT NULL            │   ║
║  │                          CHECK IN('ticket','note')    │   ║
║  │       source_system    : text     NOT NULL            │   ║
║  │       source_id        : text     NOT NULL            │   ║
║  │       target_id        : uuid     NOT NULL            │   ║
║  │       idempotency_key  : text     NOT NULL  UNIQUE    │   ║
║  │       created_at       : timestamptz NOT NULL         │   ║
║  │                                                       │   ║
║  │  UNIQUE(batch_id, source_row, entity)                 │   ║
║  │                                                       │   ║
║  │  Indexes:                                             │   ║
║  │    · crm3_import_receipts_idempotency_key  UNIQUE(ik) │   ║
║  │    · crm3_import_receipts_batch_row_entity UNIQUE     │   ║
║  │    · crm3_import_receipts_target_id_idx    (target_id)│   ║
║  └──────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 2. Relationship Table

| Relationship | Cardinality | Enforcement | Cascade |
| :--- | :--- | :--- | :--- |
| `crm1_contacts` → `crm3_tickets` (via `contact_id`) | 1 : 0..N | **Logical only** — validated via `ReferenceResolver` API at write time. No DB-level FK. CRM-3 never reads CRM-1 schema. | None |
| `crm3_tickets` → `crm3_notes` (via `ticket_id`) | 1 : 0..N | **Hard FK** — `crm3_notes.ticket_id REFERENCES crm3_tickets(id)` | `ON DELETE CASCADE` — deleting a ticket deletes all its notes |
| `crm3_import_batches` → `crm3_import_receipts` (via `batch_id`) | 1 : 0..N | **Hard FK** — `crm3_import_receipts.batch_id REFERENCES crm3_import_batches(id)` | `ON DELETE CASCADE` |
| ERP order (via `order_ref`) | — | **None** — plain text reference in V1 | None |

---

## 3. Key Constraints Summary

| Table | Key Name | Type | Columns |
| :--- | :--- | :--- | :--- |
| `crm3_tickets` | `crm3_tickets_pkey` | PRIMARY KEY | `id` |
| `crm3_tickets` | `crm3_tickets_source_key` | UNIQUE INDEX | `source_system, source_id` |
| `crm3_notes` | `crm3_notes_pkey` | PRIMARY KEY | `id` |
| `crm3_notes` | `crm3_notes_ticket_id_fkey` | FOREIGN KEY | `ticket_id → crm3_tickets(id)` |
| `crm3_import_batches` | `crm3_import_batches_pkey` | PRIMARY KEY | `id` |
| `crm3_import_batches` | `crm3_import_batches_idempotency_key` | UNIQUE INDEX | `idempotency_key` |
| `crm3_import_receipts` | `crm3_import_receipts_pkey` | PRIMARY KEY | `id` |
| `crm3_import_receipts` | `crm3_import_receipts_batch_id_fkey` | FOREIGN KEY | `batch_id → crm3_import_batches(id)` |
| `crm3_import_receipts` | `crm3_import_receipts_idempotency_key` | UNIQUE INDEX | `idempotency_key` |
| `crm3_import_receipts` | `crm3_import_receipts_batch_row_entity_key` | UNIQUE INDEX | `batch_id, source_row, entity` |

---

## 4. Master-Data Ownership Boundaries

```
┌────────────────────────────────────────────────────────────────┐
│                   MODULE OWNERSHIP MAP                         │
│                                                                │
│  CRM-1  ┌──────────────┐   owns   crm1.* schema               │
│  Module │ crm-contacts  │──────►  crm1_contacts                │
│         │ (Group 1)    │         crm1_companies                │
│         └──────────────┘         crm1_leads                    │
│                  ▲                                              │
│                  │  read-only via ReferenceResolver API         │
│                  │  (no direct SQL, no cross-schema FK)         │
│                  │                                              │
│  CRM-3  ┌──────────────┐   owns   crm3.* schema               │
│  Module │ crm-support  │──────►  crm3_tickets                  │
│         │ (Group 3)    │         crm3_notes                    │
│         └──────────────┘         crm3_import_batches           │
│                                  crm3_import_receipts          │
│                                                                │
│  ERP-3  ┌──────────────┐   read-only projection               │
│  Module │ erp-orders   │─ ─ ─►  order_ref (text field, V1)    │
│         │ (ERP Team)   │         no FK enforced               │
│         └──────────────┘                                       │
└────────────────────────────────────────────────────────────────┘
```

**Rules (non-negotiable):**
1. CRM-3 **never reads or writes** any table in the `crm1` schema directly.
2. All contact validation goes through `ReferenceResolver.get('contact_by_email', email)` or equivalent.
3. No future migration may add a `FOREIGN KEY` from `crm3_tickets.contact_id` to `crm1_contacts.id`.
4. The `order_ref` field is plain `text` in V1. A cross-module FK to ERP-3 tables is **out of scope for V2** and requires an approved API contract change.

---

*Traceability: Issue #157 [CRM3-24]. Gate G1 — Design Complete. Last updated: 2026-10-24.*
