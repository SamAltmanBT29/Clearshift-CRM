# ClearShift CRM — Entity-Relationship Diagram & Master-Data Ownership: CRM-2

**Module ID:** `CRM-2`  
**Module Name:** Deals, Pipeline Stages and Quotes  
**Owning Team:** Team `crm-deals` (Group 2 — Role 4 Data / QA Lead)  
**Schema Version:** 1.0.0  
**Storage Engine:** PostgreSQL 18.6 with Drizzle ORM  
**Target Milestone:** Gate G1 — Design Complete (Sprint 1)  
**Traceability:** ClearShift Project Plan v3.0 §§9.3–9.6, 17; SDS ClearShift CRM v2.0 §4.2, §4.7; Master Architecture Baseline 1.0-A §4.2; Issue #137 `[CRM2-24]`.

---

## 1. Visual Entity-Relationship Diagram (Mermaid)

```mermaid
erDiagram
    CRM2_STAGES ||--o{ CRM2_DEALS : "categorizes (1..N) [stage_id / RESTRICT]"
    CRM2_DEALS ||--o{ CRM2_QUOTES : "has (0..N) [deal_id / RESTRICT]"
    CRM2_QUOTES ||--o{ CRM2_QUOTE_LINES : "contains (1..N) [quote_id / CASCADE]"
    CRM2_IMPORT_BATCHES ||--o{ CRM2_IMPORT_RECEIPTS : "tracks (0..N) [batch_id / CASCADE]"
    CRM2_IMPORT_BATCHES ||--o{ CRM2_IMPORT_REJECTS : "logs (0..N) [batch_id / CASCADE]"
    CRM2_IMPORT_RECEIPTS }o--|| CRM2_DEALS : "references [target_id]"
    CRM2_IMPORT_RECEIPTS }o--|| CRM2_QUOTES : "references [target_id]"
    CRM2_IMPORT_RECEIPTS }o--|| CRM2_QUOTE_LINES : "references [target_id]"

    CRM1_CONTACTS ||--o{ CRM2_DEALS : "links (0..N) [Application Guard, NO FK]"
    ERP1_PRODUCTS ||--o{ CRM2_QUOTE_LINES : "references (0..N) [API Resolver, NO FK]"

    CRM2_STAGES {
        uuid id PK "gen_random_uuid()"
        text name UK "NOT NULL, New|Qualified|Proposal|Negotiation|Won|Lost"
        smallint position UK "NOT NULL, 1..6"
        boolean is_won "NOT NULL, true only for Won"
    }

    CRM2_DEALS {
        uuid id PK "gen_random_uuid()"
        text name "NOT NULL (non-empty)"
        uuid contact_id "Nullable -> crm1_contacts.id (Application Guard)"
        numeric value "NOT NULL, non-negative NUMERIC(14,2)"
        text currency "NOT NULL, ISO-4217 (3 uppercase letters)"
        uuid stage_id FK "NOT NULL -> crm2_stages.id (RESTRICT)"
        date close_date "Nullable, YYYY-MM-DD"
        text source_system "Nullable, paired with source_id"
        text source_id "Nullable, paired with source_system"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM2_QUOTES {
        uuid id PK "gen_random_uuid()"
        text quote_number UK "NOT NULL, UNIQUE (non-empty)"
        uuid deal_id FK "NOT NULL -> crm2_deals.id (RESTRICT)"
        date quote_date "NOT NULL, YYYY-MM-DD"
        numeric amount "NOT NULL, non-negative NUMERIC(14,2)"
        text note "Nullable free text"
        text source_system "Nullable, paired with source_id"
        text source_id "Nullable, paired with source_system"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM2_QUOTE_LINES {
        uuid id PK "gen_random_uuid()"
        uuid quote_id FK "NOT NULL -> crm2_quotes.id (CASCADE)"
        integer line_number "NOT NULL, 1-indexed (> 0)"
        uuid product_id "Nullable -> erp1_products.id (API Guard)"
        text description "NOT NULL (non-empty)"
        numeric quantity "NOT NULL, NUMERIC(12,4) > 0"
        numeric unit_price "NOT NULL, NUMERIC(14,2) >= 0"
        numeric line_total "NOT NULL, server-computed NUMERIC(14,2)"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
    }

    CRM2_IMPORT_BATCHES {
        uuid id PK "gen_random_uuid()"
        text source_system "NOT NULL (non-empty)"
        text status "NOT NULL, pending|processing|completed|failed"
        text idempotency_key UK "Nullable, unique batch key"
        text request_hash "Nullable, SHA-256 payload digest"
        integer loaded_count "NOT NULL, default 0"
        integer rejected_count "NOT NULL, default 0"
        timestamptz created_at "NOT NULL, default now()"
        timestamptz updated_at "NOT NULL, default now()"
        timestamptz completed_at "Nullable"
    }

    CRM2_IMPORT_RECEIPTS {
        uuid id PK "gen_random_uuid()"
        uuid batch_id FK "NOT NULL -> crm2_import_batches.id (CASCADE)"
        integer source_row "NOT NULL (> 0)"
        text entity "NOT NULL, deal|quote|stage|quote_line"
        text source_system "NOT NULL"
        text source_id "NOT NULL"
        uuid target_id "NOT NULL, committed entity UUID"
        text idempotency_key UK "NOT NULL, batch:row:entity key"
        timestamptz created_at "NOT NULL, default now()"
    }

    CRM2_IMPORT_REJECTS {
        uuid id PK "gen_random_uuid()"
        uuid batch_id FK "NOT NULL -> crm2_import_batches.id (CASCADE)"
        integer source_row "NOT NULL (> 0)"
        text entity "NOT NULL, deal|quote|stage|quote_line"
        text reason_code "NOT NULL, machine error code"
        text message "NOT NULL, privacy-safe diagnostic"
        timestamptz created_at "NOT NULL, default now()"
    }
```

---

## 2. Cardinality & Foreign Key Policy Matrix

| Relationship ID | Parent Entity (`from`) | Child Entity (`to`) | Foreign Key Column | Cardinality | Delete Policy | Enforcement Layer | Description |
| :--- | :--- | :--- | :--- | :---: | :---: | :--- | :--- |
| `REL-CRM2-01` | `crm2_stages` | `crm2_deals` | `stage_id` | `1:N` | `RESTRICT` | Database FK | A stage can have many deals. Deletion of a stage is prohibited while referenced by any deal. |
| `REL-CRM2-02` | `crm2_deals` | `crm2_quotes` | `deal_id` | `1:N` | `RESTRICT` | Database FK | A deal can have multiple quotes. Deletion of a deal is restricted while linked quotes exist. |
| `REL-CRM2-03` | `crm2_quotes` | `crm2_quote_lines` | `quote_id` | `1:N` | `CASCADE` | Database FK | Quote line items belong exclusively to one quote. Deleting a quote cascades to remove its lines. |
| `REL-CRM2-04` | `crm1_contacts` | `crm2_deals` | `contact_id` | `0..1:N` | *None* | Domain Application Guard | Cross-module reference to CRM-1 contact. No cross-schema FK; orphan deals permitted. |
| `REL-CRM2-05` | `erp1_products` | `crm2_quote_lines`| `product_id` | `0..1:N` | *None* | Domain API Resolver | Cross-module reference to ERP-1 product catalog. Validated via public API contracts. |
| `REL-CRM2-06` | `crm2_import_batches`| `crm2_import_receipts`| `batch_id` | `1:N` | `CASCADE` | Database FK | Per-row import receipts belong to a batch run; cascade-deleted if batch ledger pruned. |
| `REL-CRM2-07` | `crm2_import_batches`| `crm2_import_rejects` | `batch_id` | `1:N` | `CASCADE` | Database FK | Row rejections belong to an import batch; cascade-deleted if batch ledger pruned. |
| `REL-CRM2-08` | *Polymorphic* | `crm2_import_receipts`| `target_id` | `N:1` | `RESTRICT` | Domain Application Guard | Recorded commit reference linking receipt to created target business record. |

---

## 3. Master-Data Ownership & Architecture Boundaries (PLT-03)

In accordance with Master Architecture Specification Baseline 1.0-A:
1. **Module Ownership:** Group 2 owns all schema objects, tables, migrations, and routes under `crm2`. No sibling module or Migration Kit worker may issue direct SQL `INSERT`, `UPDATE`, or `DELETE` against `crm2.*` tables.
2. **Cross-Module Isolation:**
   - CRM-2 reads contacts exclusively via CRM-1's public reference resolver (`crm1Resolver.resolveContact(id)`).
   - If a referenced contact does not exist or was deleted, CRM-2 stores `contact_id` as `null` or flags the record as an orphan deal with reason code `ORPHAN_DEAL_WARNING`. The record is **never** silently dropped.
3. **Transactional Boundary:**
   - Under KIT-08, when importing deals or quotes, the target mutation in `crm2_deals` / `crm2_quotes` and the durable receipt in `crm2_import_receipts` **commit or roll back together** within the same local database transaction.
4. **Outbox Synchronization:**
   - When a deal transitions to terminal stage `Won`, a `deal.won` domain event is written atomically to the transactional outbox table within the same transaction.
