# CRM-2 Data Quality Rules Catalog

**Module ID:** `CRM-2`  
**Module Name:** Deals, Pipeline Stages and Quotes  
**Ruleset Version:** 1  
**Fixture:** `sample-data/crm-2/dirty-data-v1.csv` (SHA-256 and byte checksum validated in `expected-profile.json` and `manifest.json`)  
**Traceability:** ClearShift Project Plan v3.0 §7.2, §9.3–9.6; SDS ClearShift CRM v2.0 §4.2, §4.11; Issue #23 (`[CRM2-08]`), #139 (`[CRM2-26]`), #140 (`[CRM2-27]`), #141 (`[CRM2-28]`).

---

## 1. Principles & Non-Negotiable Invariants

1. **Raw Input Immutability:** The raw input CSV/data stream is never mutated. All cleaning, normalization, and evaluation operate on an isolated cleaned projection.
2. **Deterministic Matching Only:** No fuzzy duplicate matching or automatic destructive merge in V1. Duplicate resolution uses deterministic normalized natural keys and exact candidate business keys.
3. **Row Conservation Balance Sheet:**
   $$\text{source (100)} = \text{loaded (75)} + \text{rejected (17)} + \text{merged (8)} + \text{skipped (0)} \quad (\text{unaccounted} = 0)$$
4. **Precedence Hierarchy:** A row evaluates all applicable rules and resolves to the highest-precedence outcome:
   $$\text{reject} > \text{merge} > \text{normalize} > \text{accept}$$
5. **Orphan Representation:** Deals with nullable `contact_id` are permitted as orphan deals; they are accepted and loaded while triggering a visible UI orphan badge without hiding data.

---

## 2. Rule Catalog

| rule_id | v | field | outcome | code | input condition | reason |
|---|:---:|---|---|---|---|---|
| `CRM2-DQ-001` | 1 | `entity_type` | reject | `REQUIRED_FIELD_MISSING` | `entity_type` empty or not in `['deal', 'quote']` | `entity_type` must be either "deal" or "quote" |
| `CRM2-DQ-002` | 1 | `source_system` | reject | `REQUIRED_FIELD_MISSING` | `source_system` empty after trim | `source_system` is required for provenance tracking |
| `CRM2-DQ-003` | 1 | `source_id` | reject | `REQUIRED_FIELD_MISSING` | `source_id` empty after trim | `source_id` is required for source record mapping |
| `CRM2-DQ-004` | 1 | `name` | reject | `EMPTY_MANDATORY_FIELD` | `name` empty after trim on deal entity | Mandatory deal name is required and cannot be blank |
| `CRM2-DQ-005` | 1 | `value` | reject | `NEGATIVE_VALUE` | `value` empty, non-numeric, or negative | Deal monetary value must be a non-negative decimal quantity |
| `CRM2-DQ-006` | 1 | `currency` | reject | `INVALID_CURRENCY` | `currency` not in ISO 4217 allowlist (`USD`, `EUR`, `GBP`) | Currency must be an ISO 4217 three-letter uppercase code |
| `CRM2-DQ-007` | 1 | `stage_name` | reject | `INVALID_STAGE` | `stage_name` on deal not in standard allowlist | Specified pipeline stage does not exist in standard stage allowlist |
| `CRM2-DQ-008` | 1 | `close_date` | reject | `INVALID_DATE_FORMAT` | `close_date` on deal not valid ISO 8601 `YYYY-MM-DD` | Close date must conform to ISO 8601 format (YYYY-MM-DD) |
| `CRM2-DQ-009` | 1 | `quote_number` | reject | `EMPTY_MANDATORY_FIELD` | `quote_number` empty after trim on quote entity | Quote number is required for quote records |
| `CRM2-DQ-010` | 1 | `deal_id` | reject | `PARENT_DEAL_NOT_FOUND` | parent `deal_id` missing or not found in target store | Referenced parent deal does not exist in target database |
| `CRM2-DQ-011` | 1 | `name` | reject | `FORMULA_PREFIX` | `name` starts with formula prefix (`=`, `+`, `-`, `@`) | Spreadsheet formula injection risks are rejected |
| `CRM2-DQ-012` | 1 | `name` | normalize | `WHITESPACE_NORMALIZED` | leading/trailing whitespace or tabs in text fields | Whitespace trimmed and strings normalized |
| `CRM2-DQ-013` | 1 | `currency` | normalize | `CURRENCY_NORMALIZED` | currency provided in lowercase or mixed case | Currency code normalized to uppercase |
| `CRM2-DQ-014` | 1 | `name` | merge | `EXACT_DEAL_DUPLICATE` | deal candidate key matching earlier record in batch | Exact duplicate deal candidate key detected; merged into primary record |
| `CRM2-DQ-015` | 1 | `quote_number` | merge | `EXACT_QUOTE_NUMBER_MATCH` | `quote_number` matching earlier quote in batch | Exact duplicate quote number detected; merged into primary record |

---

## 3. Entity Fields & Specifications

### Deals (`crm2_deals`)
- **Required Fields:** `source_row`, `entity_type`, `source_system`, `source_id`, `name`, `value`, `currency`, `stage_name`, `close_date`.
- **Optional / Nullable Fields:** `contact_id` (nullable UUID for orphan deal representation).
- **Enumerations:**
  - `stage_name`: `New`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`.
  - `currency`: `USD`, `EUR`, `GBP`.
- **Duplicate Candidate Keys:**
  1. Natural Key: `${source_system}#${source_id}`
  2. Business Key: `${normalizedName}#${normalizedStage}#${contactId || 'orphan'}`

### Quotes (`crm2_quotes`)
- **Required Fields:** `source_row`, `entity_type`, `source_system`, `source_id`, `quote_number`, `deal_id`, `value` (amount), `currency`, `close_date` (quote date).
- **Optional Fields:** `note`.
- **Relationships:** `deal_id` must reference an existing target deal or a deal loaded in the same transaction.
- **Duplicate Candidate Key:** Exact normalized `quote_number` (trimmed, uppercase).

---

## 4. Mapping Template & Schema Translation

The canonical field and enum translation template is maintained in:
`sample-data/crm-2/mapping-template.json`
