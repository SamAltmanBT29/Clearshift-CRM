# CRM-2: Deals, Pipeline and Quotes Data Dictionary

## 1. Overview & Architectural Boundaries
The **CRM-2** module manages sales opportunities (deals), pipeline stages, and simple sales quotes within the ClearShift enterprise ecosystem.
- **SDS Reference:** ClearShift CRM v2.0 V1: FR-CRM2-01..05
- **API Base Route:** `/api/v1/crm-deals`
- **Owner:** Group 2 — Role 3 — Frontend / Review-screen Engineer
- **Database Schema:** PostgreSQL 18.6 with Drizzle ORM

---

## 2. Domain Invariants (Strict)
1. **Fixed Stage Set:** Pipeline stages are immutable in V1 and must strictly be:
   `New`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`.
2. **System Seeded:** Stage records are seeded during database initialization. Normal UI and standard API users cannot delete, rename, or duplicate stages.
3. **Financial Precision:** Deal values and Quote amounts are non-negative decimals with an explicit 3-letter ISO 4217 currency code (e.g. `USD`, `EUR`).
4. **Unique Quote Numbers:** Every quote has an alphanumeric identifier that is unique across all quotes.
5. **Orphan Deal Representation:** Deals can exist without a linked contact (`contact_id` is nullable). Orphan deals are never silently omitted or hidden; the UI must visibly flag orphan deals with an explicit warning indicator.
6. **No Forecasting / Kanban Board:** V1 strictly delivers list views and direct API CRUD. Forecasting engines and drag-and-drop Kanban boards are out of scope for V1.

---

## 3. Entity Definitions

### 3.1 Table: `crm2_stages`
Stores the fixed pipeline stages in monotonic display order.

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `name` | `VARCHAR(32)` | No | — | Unique stage name (`New`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`) |
| `order` | `INTEGER` | No | — | 1-based display order (1 to 6) |
| `is_closed_won` | `BOOLEAN` | No | `false` | True only for `Won` stage |
| `is_closed_lost` | `BOOLEAN` | No | `false` | True only for `Lost` stage |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Audit timestamp |

**Constraints & Indexes:**
- Primary Key: `crm2_stages_pkey (id)`
- Unique: `crm2_stages_name_unique (name)`
- Unique: `crm2_stages_order_unique (order)`

---

### 3.2 Table: `crm2_deals`
Stores individual sales opportunities.

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `name` | `VARCHAR(255)` | No | — | Opportunity title/name |
| `contact_id` | `UUID` | **Yes** | `NULL` | Nullable foreign key to Contacts. If NULL, deal is an orphan. |
| `value` | `NUMERIC(14,2)`| No | `0.00` | Opportunity financial value |
| `currency` | `CHAR(3)` | No | `'USD'` | Explicit ISO 4217 currency code |
| `stage_id` | `UUID` | No | — | Foreign key references `crm2_stages(id)` |
| `close_date` | `DATE` | No | — | Expected or actual close date |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Audit timestamp |

**Virtual / Derived Properties:**
- `is_orphan`: `BOOLEAN` := (`contact_id IS NULL`)
- `stage_name`: Stage name joined from `crm2_stages`

**Constraints & Indexes:**
- Primary Key: `crm2_deals_pkey (id)`
- Foreign Key: `crm2_deals_stage_id_fkey FOREIGN KEY (stage_id) REFERENCES crm2_stages(id)`
- Index: `idx_crm2_deals_stage (stage_id)`
- Index: `idx_crm2_deals_contact (contact_id)`
- Index: `idx_crm2_deals_close_date (close_date)`

---

### 3.3 Table: `crm2_quotes`
Stores quotes associated with deals.

| Column Name | Data Type | Nullable | Default | Description |
|---|---|---|---|---|
| `id` | `UUID` | No | `gen_random_uuid()` | Primary Key |
| `deal_id` | `UUID` | No | — | Foreign key references `crm2_deals(id)` |
| `quote_number` | `VARCHAR(64)` | No | — | Globally unique quote reference (e.g. `Q-2026-001`) |
| `date` | `DATE` | No | — | Quote issuance date |
| `amount` | `NUMERIC(14,2)`| No | `0.00` | Quote financial total |
| `currency` | `CHAR(3)` | No | `'USD'` | ISO 4217 currency code |
| `note` | `TEXT` | Yes | `NULL` | Optional terms or description |
| `created_at` | `TIMESTAMPTZ` | No | `NOW()` | Audit timestamp |
| `updated_at` | `TIMESTAMPTZ` | No | `NOW()` | Audit timestamp |

**Constraints & Indexes:**
- Primary Key: `crm2_quotes_pkey (id)`
- Foreign Key: `crm2_quotes_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES crm2_deals(id) ON DELETE CASCADE`
- Unique: `crm2_quotes_number_unique (quote_number)`
- Index: `idx_crm2_quotes_deal (deal_id)`

---

## 4. API & Data Model Alignment
All endpoint request payloads, query filters, and response representations strictly reflect these tables and invariants:
- `GET /api/v1/crm-deals/deals`: Returns paginated list of deals with `is_orphan` flag and `stage_name`.
- `GET /api/v1/crm-deals/stages`: Returns seeded stages ordered by `order ASC`.
- `GET /api/v1/crm-deals/quotes`: Returns quotes linked to deals.
