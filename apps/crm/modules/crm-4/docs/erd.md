# ClearShift CRM — Entity-Relationship Diagram & Master-Data Ownership: CRM-4

**Module ID:** `CRM-4`
**Module Name:** Marketing Lists and Campaign History
**Owning Team:** Team `crm-marketing` (Group 4 — Role 4 Data / QA Lead)
**Schema Version:** 1.0.0
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.5, §4.7; Master Architecture Baseline 1.0-A §4.2; Issue #177 `[CRM4-24]`.

---

## 1. Visual Entity-Relationship Diagram (Mermaid)

```mermaid
erDiagram
    CRM4_LISTS ||--o{ CRM4_CAMPAIGNS : "contains (1..N) [list_id / RESTRICT, IMMUTABLE]"
    CRM4_CAMPAIGNS ||--o{ CRM4_MEMBERS : "has (0..N) [campaign_id / CASCADE]"
    CRM4_IMPORT_BATCHES ||--o{ CRM4_IMPORT_RECEIPTS : "tracks (0..N) [batch_id / CASCADE]"
    CRM4_IMPORT_BATCHES ||--o{ CRM4_IMPORT_REJECTS : "logs (0..N) [batch_id / CASCADE]"
    CRM4_IMPORT_RECEIPTS }o--|| CRM4_LISTS : "references [target_id]"
    CRM4_IMPORT_RECEIPTS }o--|| CRM4_CAMPAIGNS : "references [target_id]"
    CRM4_IMPORT_RECEIPTS }o--|| CRM4_MEMBERS : "references [target_id]"
    CRM4_IMPORT_RECEIPTS }o--|| CRM4_CONSENTS : "references [target_id]"

    CRM1_CONTACTS ||--o{ CRM4_MEMBERS : "participates (0..N) [Application Guard, NO SQL FK]"
    CRM1_CONTACTS ||--|| CRM4_CONSENTS : "governs (1..1) [Application Guard, NO SQL FK]"

    CRM4_LISTS {
        uuid id PK "gen_random_uuid()"
        text name "NOT NULL, non-empty"
        text description "Nullable free text"
        integer campaign_count "NOT NULL, default 0, >= 0"
        integer member_count "NOT NULL, default 0, >= 0"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM4_CAMPAIGNS {
        uuid id PK "gen_random_uuid()"
        text name "NOT NULL, non-empty"
        date campaign_date "NOT NULL, YYYY-MM-DD"
        uuid list_id FK "NOT NULL -> crm4_lists.id (RESTRICT, IMMUTABLE)"
        integer member_count "NOT NULL, default 0, >= 0"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM4_MEMBERS {
        uuid id PK "gen_random_uuid()"
        uuid campaign_id FK "NOT NULL -> crm4_campaigns.id (CASCADE)"
        uuid contact_id "NOT NULL -> crm1_contacts.id (Application Guard)"
        text status "NOT NULL, sent|opened|clicked"
        boolean unsubscribed "NOT NULL, default false"
        timestamptz created_at "NOT NULL, default now()"
    }

    CRM4_CONSENTS {
        uuid id PK "gen_random_uuid()"
        uuid contact_id UK "NOT NULL -> crm1_contacts.id (Application Guard, UNIQUE)"
        text status "NOT NULL, subscribed|unsubscribed (BR-CRM4-01 monotonic)"
        timestamptz consent_date "NOT NULL, default now()"
        text source "NOT NULL, non-empty"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM4_IMPORT_BATCHES {
        uuid id PK "gen_random_uuid()"
        text source_system "NOT NULL, non-empty"
        text status "NOT NULL, pending|processing|completed|failed"
        text idempotency_key UK "Nullable, unique token"
        text request_hash "Nullable, paired with idempotency_key"
        integer loaded_count "NOT NULL, default 0, >= 0"
        integer rejected_count "NOT NULL, default 0, >= 0"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
        timestamptz completed_at "Nullable, terminal timestamp"
    }

    CRM4_IMPORT_RECEIPTS {
        uuid id PK "gen_random_uuid()"
        uuid batch_id FK "NOT NULL -> crm4_import_batches.id (CASCADE)"
        integer source_row "NOT NULL, > 0"
        text entity "NOT NULL, list|campaign|member|consent"
        text source_system "NOT NULL, non-empty"
        text source_id "NOT NULL, non-empty"
        uuid target_id "NOT NULL"
        text idempotency_key UK "NOT NULL, unique durable key"
        timestamptz created_at "NOT NULL, default now()"
    }

    CRM4_IMPORT_REJECTS {
        uuid id PK "gen_random_uuid()"
        uuid batch_id FK "NOT NULL -> crm4_import_batches.id (CASCADE)"
        integer source_row "NOT NULL, > 0"
        text entity "NOT NULL, list|campaign|member|consent"
        text reason_code "NOT NULL, non-empty"
        text message "NOT NULL, non-empty"
        timestamptz created_at "NOT NULL, default now()"
    }
```

---

## 2. Cardinality & Relational Catalog

| Relationship ID | Source Entity | Source Column | Target Entity | Target Column | Cardinality | Delete Action | Enforcement Mechanism | Architectural Rules & Invariants |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `REL-CRM4-01` | `crm4_campaigns` | `list_id` | `crm4_lists` | `id` | **N:1** | `RESTRICT` | Database Foreign Key | **List Immutability:** Once a campaign is created, `list_id` cannot be modified or reassigned. Deleting a list with campaigns is RESTRICTED. |
| `REL-CRM4-02` | `crm4_members` | `campaign_id` | `crm4_campaigns` | `id` | **N:1** | `CASCADE` | Database Foreign Key | Participant history rows cascade on parent campaign deletion. |
| `REL-CRM4-03` | `crm4_members` | `contact_id` | `crm1_contacts` | `id` | **N:1** | `RESTRICT` | Domain Application Guard | Cross-module reference to CRM-1 contacts. No direct SQL foreign key across schema boundaries (PLT-03). |
| `REL-CRM4-04` | `crm4_consents` | `contact_id` | `crm1_contacts` | `id` | **1:1** | `RESTRICT` | Domain Application Guard | Exactly one current consent record per contact. Enforces `BR-CRM4-01` monotonic opt-out invariant. |
| `REL-CRM4-05` | `crm4_import_receipts` | `batch_id` | `crm4_import_batches` | `id` | **N:1** | `CASCADE` | Database Foreign Key | Durable receipts committed in transaction with target entity rows; cascade on batch purge. |
| `REL-CRM4-06` | `crm4_import_rejects` | `batch_id` | `crm4_import_batches` | `id` | **N:1** | `CASCADE` | Database Foreign Key | Detailed rejection ledger rows cascade on batch purge. |
| `REL-CRM4-07` | `crm4_import_receipts` | `target_id` | `Target Entities` | `id` | **N:1** | `CASCADE` | Domain Application Guard | Polymorphic mapping from durable import receipts to the loaded target entity row. |

---

## 3. Master-Data Ownership & Cross-Module Boundaries (PLT-03)

1. **CRM-1 Contacts Master-Data Isolation:**
   - CRM-4 stores and manages **marketing lists, campaign engagement history, and contact consent state**.
   - Contact records (`first_name`, `last_name`, `email`, `phone`, `company_id`) are exclusively owned by module **CRM-1**.
   - Foreign keys to `crm1_contacts` are intentionally **omitted** at the PostgreSQL DDL layer to prevent cross-module coupling. Integrity is guaranteed via the CRM-1 Public Reference Resolver API (`assertContactExists`).

2. **Cross-Module Consent Projection:**
   - Modules CRM-1, CRM-2, CRM-3, and CRM-5 never read or mutate `crm4_consents` directly via SQL.
   - All modules consume the CRM-4 Public Reference Resolver (`crm4Resolver.getConsentStatus(contactId)`) or HTTP GET `/api/v1/crm-marketing/consents/:contact`.
   - The UI surfaces the `unsubscribed` status badge in contact overview screens as required by `FR-CRM4-05`.

3. **Atomic Transactional Invariant (KIT-08):**
   - During migration loads, target rows and their corresponding `crm4_import_receipts` are committed together in a single PostgreSQL transaction.
   - If either write fails, the entire transaction rolls back cleanly, and a rejection row is written to `crm4_import_rejects`.
