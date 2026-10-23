# ClearShift Migration Kit V1 Operational Runbook

**Document ID:** RUNBOOK-KIT-01  
**Issue Reference:** [KIT-01] Batch registry, state machine and immutable step ledger (#68)  
**Target Milestone:** Gate G4 (V1 Build Complete)  
**Author / Workstream:** Team 11 — Platform & Migration Kit Lead  
**Classification:** Operational Architecture & Failure-Safety Runbook  
**Status:** Approved & Enforced  

---

## 1. Executive Summary & Core Requirements

The seven-step pipeline is ClearShift’s core migration engine. A simple CRUD approach does not satisfy V1; the Kit must ingest, transform, load, validate, and reconcile repeatable datasets while guaranteeing strict auditability and mathematical row reconciliation.

This runbook documents:
1. The **Batch Registry (`kit_batches`)** tracking lifecycle state, attempts, checkpoints, telemetry, and correlation IDs.
2. The **State Machine & Transition Guard** enforced at both application and database engine levels.
3. The **Immutable Step Ledger (`kit_batch_steps`)** providing an append-only audit trail with zero in-place mutations.
4. The **Checkpoint Resumption Protocol** guaranteeing that retries resume safely from committed checkpoints and never restart implicitly from `created`.
5. The **Reconciliation Equation** ensuring `source = loaded + rejected + merged + skipped` with `unaccounted = 0`.

---

## 2. Seven-Step Migration Pipeline & State Graph

### 2.1 The Seven Steps
1. **Extract:** Parses CSV/XLSX source file into raw rows; verifies SHA-256 checksum and row count.
2. **Profile:** Computes empty, invalid, and duplicate frequency counts; generates column profiling report.
3. **Clean:** Executes approved cleaning rules (e.g. whitespace trim, casing normalization, phone/tax validation); logs dirty-to-clean diffs.
4. **Map:** Applies field and value mapping templates; verifies required target entity fields.
5. **Dry-Run:** Simulates data insertion with strict zero-target-mutation; computes predicted rejection rates.
6. **Load:** Executes chunked atomic database load (up to 500 rows per PostgreSQL transaction) with stable idempotency keys and import receipts.
7. **Validate & Reconcile:** Validates referential and business integrity post-load; verifies that every source row has exactly one terminal outcome.

### 2.2 Lifecycle State Transitions

```
[ created ]
     │
     ▼
[ extracting ] ──────► [ failed ]
     │                      ▲
     ▼                      │
[ extracted ]  ──────► [ failed ]
     │                      ▲
     ▼                      │
[ profiled ]   ──────► [ failed ]
     │                      ▲
     ▼                      │
[ cleaned ]    ──────► [ failed ]
     │                      ▲
     ▼                      │
[ mapped ]     ──────► [ failed ]
     │                      ▲
     ▼                      │
[ dry_run_passed ] ──► [ failed ]
     │                      ▲
     ▼                      │
 [ loading ]   ──────► [ failed ]
     │  ▲                   ▲
     │  └── [ load_failed_partial ] ──► [ rollback_pending ]
     │              │                          │
     │              ▼                          ▼
     │         [ failed ]             [ rollback_blocked ] / [ rolled_back ]
     ▼
  [ loaded ]   ──────► [ failed ]
     │                      ▲
     ▼                      │
[ validating ] ──────► [ failed ]
     │                      ▲
     ▼                      │
[ validated ]  ──────► [ failed ]
     │
     ▼
[ reconciled ] (TERMINAL SUCCESS)
```

### 2.3 State Classifications
- **Success Path (Forward-Only):**  
  `created` ➔ `extracting` ➔ `extracted` ➔ `profiled` ➔ `cleaned` ➔ `mapped` ➔ `dry_run_passed` ➔ `loading` ➔ `loaded` ➔ `validating` ➔ `validated` ➔ `reconciled`
- **Failure & Side States:**  
  `failed`, `load_failed_partial`, `rollback_pending`, `rollback_blocked`, `rolled_back`
- **Terminal States (Immutable):**  
  `reconciled` (complete success), `rolled_back` (complete reversal)
- **Resumable States:**  
  `failed`, `load_failed_partial`

---

## 3. Database Guards & Constraints

### 3.1 Transition Guard Trigger (`trg_guard_kit_batch_transition`)
PostgreSQL trigger `trg_guard_kit_batch_transition` executes BEFORE UPDATE OF `status` ON `public.kit_batches`:
- **Blocks Out-of-Order Jumps:** Attempting to skip pipeline steps (e.g., `created -> loading` or `extracted -> loaded`) raises an exception with SQLSTATE `22000`.
- **Prevents Implicit Restart:** Attempting to transition to `created` from any active or failed state raises an exception:
  ```
  Illegal state transition: batch <id> cannot restart from created implicitly; must resume from committed checkpoint
  ```
- **Blocks Terminal Reversion:** Batches in `reconciled` or `rolled_back` status reject all subsequent updates.
- **Enforces Reconciliation Invariant:** Transition to `reconciled` checks:
  $$\text{total\_rows} = \text{loaded\_rows} + \text{rejected\_rows} + \text{merged\_rows} + \text{skipped\_rows}$$
  and verifies $\text{unaccounted\_rows} = 0$.

### 3.2 Append-Only Step Ledger (`trg_guard_kit_batch_steps_immutable`)
PostgreSQL trigger `trg_guard_kit_batch_steps_immutable` executes BEFORE UPDATE OR DELETE ON `public.kit_batch_steps`:
- Strict append-only ledger; `UPDATE` and `DELETE` queries are aborted.
- Every state transition inserts a new sequential record with telemetry counts (`records_in`, `records_out`, `records_rejected`, `records_merged`, `records_skipped`), `duration_ms`, `correlation_id`, `actor`, and rule versions.

---

## 4. Checkpoint Resumption Protocol

ClearShift V1 strictly prohibits restarting failed batches from `created`. When a worker process fails or the error threshold is breached, the batch state transitions to `failed` or `load_failed_partial`.

### 4.1 Checkpoint-to-Resume Mapping Table

| Committed Checkpoint | Meaning | Valid Resume Target | Next Step Action |
|---|---|---|---|
| `created` | Upload registered, extraction pending | `extracting` | Run Step 1 (Extract) |
| `extracted` | Source rows extracted and verified | `profiled` | Run Step 2 (Profile) |
| `profiled` | Column statistics computed | `cleaned` | Run Step 3 (Clean) |
| `cleaned` | Cleaning rules applied | `mapped` | Run Step 4 (Map) |
| `mapped` | Entity mappings verified | `dry_run_passed`| Run Step 5 (Dry-Run) |
| `dry_run_passed` | Simulation complete without mutation | `loading` | Run Step 6 (Load) |
| `load_checkpoint` | Chunk load halted / partial writes committed | `loading` | Resume Step 6 from last idempotency key |
| `loaded` | Business entity rows & receipts committed | `validating` | Run Step 7 (Validate) |
| `validated` | Post-load integrity checks passed | `reconciled` | Finalize reconciliation |

### 4.2 Resumption Procedure
1. Inspect the batch failure reason, error code, and committed checkpoint:
   ```sql
   SELECT id, batch_number, status, checkpoint, attempt, error_code, error_message
   FROM public.kit_batches
   WHERE id = 'BATCH_UUID';
   ```
2. Trigger resumption via Migration Kit CLI or API:
   ```bash
   # CLI
   cs-kit batch resume --batch B-00042 --reason "transient_db_timeout_resolved"
   ```
   ```http
   POST /api/v1/migration-kit/batches/BATCH_UUID/resume
   Content-Type: application/json

   {
     "actor": "operator_sarah",
     "reason": "transient_db_timeout_resolved"
   }
   ```
3. The engine verifies `attempt < max_attempts` (default 3), advances the attempt counter, and resumes execution strictly from the committed checkpoint.

---

## 5. Failure-Safety & 10% Error Threshold Rule

1. **Stop Threshold:** If cumulative row rejections exceed **10%** of attempted rows in a batch of $\ge 50$ rows, workers must immediately halt ingestion.
2. **State Transition:** The batch status transitions to `load_failed_partial`, preserving all committed row receipts and ledger steps.
3. **Receipt Immutability:** Rows loaded before the halt threshold remain committed alongside their `crm5_import_receipts` or domain entity import receipts. Retrying the batch skips already-committed rows idempotently using the composite key:
   $$\text{batch\_id} + \text{source\_row} + \text{target\_entity} + \text{schema\_version}$$

---

## 6. Audit Trail Compliance & Observability

- **Platform Audit Trail:** Every batch creation and transition logs an immutable entry to `public.audit_logs` (PLT-10) with the caller's identity, role, action code (`kit.batch.created`, `kit.batch.transitioned`, `kit.batch.failed`), and redacted metadata.
- **End-to-End Correlation (PLT-11):** Every API request, background job, database row, and audit record propagates the `correlation_id` header across service boundaries.
- **Zero Raw Data Leakage:** Application logs never emit raw unmasked PII, source row payloads, or credentials.

---

## 7. Streamed Source Upload, Parser Limits & Raw Immutability (KIT-02)

### 7.1 Architecture & Node Stream Pipeline

The Migration Kit ingests source files without full-file in-memory buffering using `@fastify/multipart` and Node.js native streams. The upload pipeline coordinates four stages:

```
[ Incoming Multipart Stream ]
           │
           ▼
[ Restricted File Storage (0o440) + SHA-256 Digest ]
           │
           ▼
[ Bounded Stream Parser (CSV / XLSX First Sheet) ]
           │ (Chunks of 500 rows)
           ▼
[ Immutable Raw Landing Table (public.raw_rows) ]
           │
           ▼
[ Batch Transition to 'extracted' with Diagnostics ]
```

### 7.2 Non-Negotiable Ingestion Limits

The pipeline enforces hard boundary limits before and during parsing. Exceeding any limit immediately halts execution with an explicit `IngestionLimitError`:

| Parameter | Limit | Enforcement Point | Error Code |
|---|---|---|---|
| **Max File Size** | 50 MiB (`52,428,800` bytes) | Stream storage & parser | `MAX_FILE_SIZE` |
| **Max Expanded XLSX Archive** | 250 MiB (`262,144,000` bytes) | ZIP entry inspection | `MAX_EXPANDED_ARCHIVE` |
| **Max Column Count** | 100 columns | Header & data row parse | `MAX_COLUMNS` |
| **Max Data Row Count** | 100,000 rows | Stream accumulator | `MAX_DATA_ROWS` |
| **Max Cell Size** | 64 KiB (`65,536` bytes) | Cell buffer accumulator | `MAX_CELL_SIZE` |

### 7.3 Format-Specific Parser Rules

#### 7.3.1 UTF-8 CSV Parser
- **Delimiters:** Comma (`,`) or semicolon (`;`), selectable by user.
- **Strict UTF-8:** Validated via `TextDecoder('utf-8', { fatal: true, ignoreBOM: true })`. Any malformed byte sequence immediately rejects the file with `InvalidEncodingError` (`INVALID_ENCODING`).
- **UTF-8 BOM:** Stripped *only* if present at the very beginning of the first header cell (`\uFEFF`). BOM presence is recorded in `diagnostics.hasBom`.
- **RFC-4180 Multiline & Quotes:** Quoted cells containing embedded line breaks (`\n`, `\r\n`) and escaped quotes (`""`) remain part of that single cell. Unclosed quotes at end-of-file throw `MalformedFileError`.
- **Blank Physical Rows:** Rows containing only whitespace or empty cells are ignored from source data rows, recorded in `diagnostics.blankRowsCount`, and **never** counted as skipped business rows in reconciliation.

#### 7.3.2 XLSX First Worksheet Parser
- **Target Selection:** Bounded parser inspects the ZIP container and reads only the first worksheet (`xl/worksheets/sheet1.xml`), resolving shared strings (`xl/sharedStrings.xml`) and inline strings (`inlineStr`).
- **Security Rejections:**
  - **Macros:** Any archive entry containing `vbaProject.bin`, `vbaData.xml`, or ending in `.xlsm`/`.xltm` is rejected with `SecurityRejectedError` (`SECURITY_REJECTED`).
  - **Encryption:** Password-protected or encrypted entries (bit 0 set, `EncryptedPackage`, or `EncryptionInfo`) are rejected with `SecurityRejectedError`.
  - **ZIP-Bombs:** Archives with compression ratios exceeding 150:1 on non-trivial streams (>10 MB uncompressed) or exceeding the 250 MiB expanded limit are aborted immediately.

### 7.4 Restricted Local Storage & File Security
- Source files are persisted to restricted local directory `storage/raw-uploads/${batchId}_${sanitizedFileName}`.
- Path traversal sequences (`..`) and unsafe characters are stripped.
- Permissions are strictly set to read-only `0o440` upon stream completion.
- SHA-256 hash is computed in the streaming pipeline and verified against the batch record.

### 7.5 Immutable Raw Landing Table (`public.raw_rows`)
- Raw source rows are persisted to PostgreSQL table `public.raw_rows`:
  - `batch_id`: References `public.kit_batches(id)`
  - `source_row`: 1-based sequential row index
  - `headers`: Ordered string array of headers
  - `cells`: Ordered string array of cell values
  - `payload`: JSONB key-value mapping of header to cell
  - `row_hash`: SHA-256 hash of canonical row JSON
- **PostgreSQL Trigger Guard:** `trg_guard_raw_rows_immutable` executes `BEFORE UPDATE OR DELETE ON public.raw_rows` and raises an exception with SQLSTATE `22000`, guaranteeing absolute raw immutability.
- **Chunked Writes:** Rows are written in batches of 500 rows to bound memory consumption during large 100,000-row uploads.

### 7.6 File-Level Failure Invariant
- Any parser error, encoding failure, or limit breach is treated strictly as a **file-level failure**.
- The batch transitions to `failed` with the exact error code (e.g. `MAX_COLUMNS`, `INVALID_ENCODING`, `SECURITY_REJECTED`).
- **Zero Row Fabrication:** The engine never fabricates partial row rejection outcomes or skipped records for file-level ingest failures.

---

## 8. Column Profiling, Data Health Report & Stable Export (KIT-03)

### 8.1 Non-Destructive Profiling Architecture

Step 2 (Profile) inspects the extracted raw rows without mutating `public.raw_rows`. It computes column health metrics, data type conformances, value distributions, and exact duplicate candidate clusters:

```
[ Immutable Raw Rows (public.raw_rows) ]
                  │
                  ▼
   ┌──────────────────────────────┐
   │       Column Profiler        │
   │  - Null / Empty Counts       │
   │  - Inferred Data Types       │
   │  - Format Violation Rates    │
   │  - Top 5 Frequency Analysis  │
   │  - Min / Max Extrema         │
   └──────────────┬───────────────┘
                  │
                  ▼
   ┌──────────────────────────────┐
   │   Exact Duplicate Detector   │
   │  - Declared Key Fields       │
   │  - Exact Normalized Matching │
   │  - Group & Row Candidate Idx │
   └──────────────┬───────────────┘
                  │
                  ├──────────────────────────────┐
                  ▼                              ▼
     [ public.kit_profile_reports ]   [ public.outbox ]
       Persistent Metric Table          'batch.profiled' Event
                  │
                  ▼
     [ Formula-Safe CSV Export ]
       Spreadsheet Safe (' Prefix)
```

### 8.2 Computed Column Metrics

For every column in the dataset, the profiler generates deterministic statistics:
- **`totalRows`**: Total row count across the file.
- **`emptyCount`**: Count of blank or whitespace-only cells.
- **`distinctCount`**: Count of unique non-empty values.
- **`inferredType`**: Detected dominant data type (`uuid`, `email`, `phone`, `integer`, `decimal`, `date`, `boolean`, `json`, or `string`).
- **`invalidCount`**: Count of non-empty values that violate the inferred or declared type pattern.
- **`topValues`**: Up to 5 most frequent values with their absolute count and percentage, sorted descending by count, with alphabetical tie-breaking for determinism.
- **`minValue` / `maxValue`**: Extrema across non-empty values.

### 8.3 Exact-Duplicate Candidate Detection

- **Declared Keys:** Evaluates one or more declared key fields (e.g. `email` for contacts, `sku` for products, `tax_number` or `id` for companies).
- **Normalized Exact Matching:** Trims whitespace and normalizes email casing to lowercase. Does not perform fuzzy auto-merge (strict V1 boundary).
- **Cluster Accounting:** Accurately reports `totalDuplicates` (total rows participating in duplicate candidate groups) and `uniqueDuplicateKeys`.

### 8.4 Canonical 1,000-Row Fixture & Manifest

ClearShift V1 provides a canonical 1,000-row integration Dirty Data Pack under `sample-data/dirty-data-pack/`:
- **`dirty-data-v1.csv`**: Exactly 1,000 rows verified against committed SHA-256 digest `63db7e77a072fb9fda42ad6d3a9132c455a0a11de2f7f618e774577b89179362`.
- **`expected-profile.json`**: Pre-calculated problem manifest matching SDS §4.14 TS-02:
  - **80 Duplicates:** 40 primary rows and 40 exact duplicate copies sharing identical email keys (rows 111–190).
  - **60 Format Errors:** 25 invalid emails, 20 malformed phone numbers, 15 non-numeric revenues (rows 51–110).
  - **50 Empty Required Fields:** 30 empty `first_name` and 20 empty `company` fields (rows 1–50).
  - **810 Clean Records:** Valid distinct baseline rows (rows 191–1000).

### 8.5 Formula-Safe CSV Export

When exporting the profile data health report to CSV for operator review:
- **Formula Neutralization:** Cells beginning with formula triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) are automatically prepended with a single quote (`'`), neutralizing spreadsheet formula injection exploits.
- **Deterministic Formatting:** Output sections, columns, and top value distributions are sorted deterministically, guaranteeing byte-for-byte reproducibility across runs.

### 8.6 Step Completion & Outbox Event Emission

Upon completing profiling:
1. Column profile records persist into `public.kit_profile_reports`.
2. The batch registry transitions batch status to `profiled` and records step execution in `public.kit_batch_steps`.
3. A standardized outbox event `batch.profiled` conforming to `EventEnvelopeSchema` is written to `public.outbox`:
   ```json
   {
     "eventType": "batch.profiled",
     "aggregateType": "kit_batch",
     "aggregateId": "BATCH_UUID",
     "payload": {
       "batchId": "BATCH_UUID",
       "module": "crm",
       "emptyCount": 50,
       "invalidCount": 60,
       "duplicateCount": 80,
       "totalRows": 1000,
       "columnsCount": 8,
       "rulesetVersion": 1
     }
   }
   ```

---

## 9. V1 Cleaning Rule Registry, Rejection & Per-Field Audit Trail (KIT-04)

### 9.1 Shared Cleaning Architecture

Step 3 (Clean) processes extracted raw rows from `public.raw_rows` deterministically without mutating source records. It normalizes data according to the 12 core rules, rejects records with required-field violations, logs every modified field to `public.kit_clean_log`, stages records in `public.stg_rows`, and publishes `batch.cleaned` to `public.outbox`:

```
   [ Raw Rows (public.raw_rows) ]
                 │
                 ▼
     [ Cleaning Rule Registry ]
     (12 Core V1 Rules from @cs/core)
                 │
        ┌────────┴────────┐
        ▼                 ▼
   [ Valid / Clean ]   [ Required Failure ]
        │                 │
        ▼                 ▼
   Normalize & Log     Reject Row
   (kit_clean_log)     (kit_rejects)
        │                 │
        └────────┬────────┘
                 ▼
      [ Staging (stg_rows) ]
                 │
                 ▼
    [ Outbox: batch.cleaned ]
```

### 9.2 The 12 V1 Cleaning Rules (`@cs/core/cleaning`)

| Rule ID | Name | Behavior | Failure Outcome |
|---|---|---|---|
| **`RL-TEXT-01`** | Whitespace Normalizer | Trims leading and trailing spaces; collapses multiple internal spaces into a single ASCII space. | Safe fallback |
| **`RL-TEXT-02`** | Control Char Sanitizer | Strips ASCII control characters `[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]` and BOM (`\uFEFF`). | Safe fallback |
| **`RL-NAME-01`** | Name Proper Casing | Capitalizes names to title case; preserves special prefixes (`O'Brien`, `McDonald`, `MacArthur`, `van der`, `de`, `di`) and hyphens (`Mary-Jane`). | Safe fallback |
| **`RL-EMAIL-01`** | Email Sanitizer & Validator | Trims, lowercases, verifies exactly one `@` sign and valid domain with at least one dot. | Required: reject with TS-05 reason ("Email is not valid: value has no @ sign"). Optional: flag warning. |
| **`RL-PHONE-01`** | Phone Standardization | Keeps digits and leading `+`. Automatically prepends declared file country code (e.g. `+1`) to 10-digit national numbers; verifies E.164 length (7–15 digits). | Required: reject with `INVALID_PHONE`. Optional: flag warning. |
| **`RL-DATE-01`** | Date Normalizer | Parses dates matching declared file format (`YYYY-MM-DD`, `DD-MM-YYYY`, `MM/DD/YYYY`) and outputs canonical ISO-8601 (`YYYY-MM-DD`). | Required: reject with `INVALID_DATE`. Optional: flag warning. |
| **`RL-CURRENCY-01`** | Currency Normalizer | Strips currency symbols (`$`, `€`, `£`, `₹`, `¥`), eliminates thousand separators, formats as exact 2-decimal string via `Decimal.js`. | Required: reject with `INVALID_CURRENCY`. Optional: flag warning. |
| **`RL-ADDR-01`** | Address Standardization | Standardizes cities and countries from an editable canonical dictionary (`Bombay` -> `Mumbai`, `Calcutta` -> `Kolkata`, `US` -> `United States`). | Retains value if unmapped |
| **`RL-REQ-01`** | Required Fields Check | Checks that designated required fields are present and non-blank. | Required: reject row with `REQUIRED_FIELD_MISSING` and simple message ("Required field '<field>' is missing or empty"). |
| **`RL-FORMAT-01`** | Generic Format Validator | Validates email, phone, date, and tax format patterns against declared field types. | Required: reject row with `INVALID_FORMAT`. Optional: flag warning. |
| **`RL-DUP-01`** | Duplicate Key Normalizer | Normalizes duplicate matching keys (e.g. `sku`, `tax_number`, `external_id`) to canonical form. | Safe fallback |
| **`RL-TAX-01`** | Tax ID Format Check | Normalizes tax identifiers (US EIN, EU VAT, IN GSTIN). If ambiguous or unfamiliar, flags `unknown` instead of rejecting when unsure (SDS RL-TAX-01). | Retains value & flags warning |

### 9.3 Runtime Rule Toggles (On/Off Switches)

Operators can enable or disable individual rules at runtime per batch execution:
```ts
const result = await cleanService.cleanBatch(batchId, {
  requiredFields: ['first_name', 'company', 'email'],
  phoneCountry: '+1',
  dateFormat: 'YYYY-MM-DD',
  disabledRules: ['RL-NAME-01'], // Disables name proper casing for this run
});
```

### 9.4 Per-Field Change Audit Trail (`public.kit_clean_log`)

Every field value modified by a cleaning rule records an immutable audit log entry:
- **`batch_id`**: Batch UUID.
- **`source_row`**: 1-based source row index.
- **`field_name`**: Column name that was transformed.
- **`old_value`**: Pre-cleaning value (masked if sensitive).
- **`new_value`**: Post-cleaning value (masked if sensitive).
- **`rule_id`**: Identifier of the rule that made the change (e.g. `RL-EMAIL-01`).
- **`rule_version`**: Version of the rule library (default `1.0.0`).

### 9.5 Sensitive Data Redaction (PLT-10 Compliance)

Any field containing sensitive data (passwords, tokens, tax IDs, salaries, compensation, bank accounts, credit cards) is automatically masked prior to audit log persistence:
- Masking format: `****<last4>` for accounts/tax IDs, `[REDACTED_FINANCIAL]` or `****<last4>` for salaries, and `[REDACTED_SECRET]` for credentials.
- Guarantees zero PII or credential leakage to operator logs or audit tables.

### 9.6 Staging & Raw Immutability

- Cleaned and rejected records are staged in `public.stg_rows` with `status` (`cleaned` or `rejected`), `payload`, and `reject_reason`.
- Rejections are cataloged in `public.kit_rejects` with `reason_code`, `reason_text`, and `raw_json`.
- Pre-cleaning and post-cleaning cryptographic SHA-256 hashes of `public.raw_rows` are compared; any difference halts execution with an invariant violation error.

### 9.7 Step Completion & Outbox Event Emission

Upon completing Step 3:
1. Batch registry records execution in `public.kit_batch_steps` (step name `clean`, status `cleaned`).
2. Batch status in `public.kit_batches` transitions to `cleaned` with updated `rejected_rows` count.
3. Outbox event `batch.cleaned` is committed atomically:
   ```json
   {
     "eventType": "batch.cleaned",
     "aggregateType": "kit_batch",
     "aggregateId": "BATCH_UUID",
     "payload": {
       "batchId": "BATCH_UUID",
       "module": "crm",
       "cleanedRows": 925,
       "rejectedRows": 75,
       "totalRows": 1000,
       "durationMs": 185,
       "ruleVersion": "1.0.0"
     }
   }
   ```

---

## 10. Step 4: Field Mapping, Value-Conversion Templates and Required-Target Enforcement (KIT-05)

### 10.1 Pipeline Stage Overview

Step 4 (**Map**) maps normalized source columns from cleaned staging rows (`public.stg_rows`) into target domain entity fields (e.g., Contacts, Leads, Companies). It performs old-value-to-new-value lookups, enforces strict required-target field contracts, isolates transformed records into `public.clean_crm` with target fields only, records state transitions in `public.kit_batch_steps`, and emits `batch.mapped` outbox events.

```
       [public.stg_rows] (cleaned rows)
              │
              ▼
   ┌──────────────────────────────────────────────┐
   │ Mapping Engine                               │
   │ 1. Validate template against Target Schema   │
   │    (Assert all required target fields mapped)│
   │ 2. Field Name Transformations                │
   │ 3. Value-Conversion Lists (old -> new)       │
   │ 4. Target Enum Validation & Normalization    │
   └───────┬──────────────────────────────┬───────┘
           │ (valid mapped rows)          │ (conversion rejects)
           ▼                              ▼
  [public.clean_crm]             [public.kit_rejects]
(Target fields only +           (INVALID_ENUM_CONVERSION)
 batch/source row linkage)
```

### 10.2 Required-Target Field Enforcement Invariant

Before any database write or pipeline execution:
1. The target entity's required fields are identified (e.g. `firstName`, `lastName`, `email` for Contacts).
2. The mapping template is checked to ensure every required target field is explicitly mapped to a non-empty source column.
3. If any required target field is missing from the mapping:
   - Pipeline execution and downstream dry run are **immediately blocked**.
   - No records are inserted into `public.clean_crm`.
   - The operation fails with explicit field and template identifiers:
     `MISSING_REQUIRED_MAPPING: Required target field(s) [email] have no source column mapping in template 'Standard CRM Contacts' (ID: t1000000-0000-4000-8000-000000000001, Module: crm)`.

### 10.3 Value-Conversion Lists & Enum Validation

- Enumerated and status fields are mapped using declarative lookup rules:
  ```json
  {
    "targetField": "leadStatus",
    "mappings": {
      "NEW": "New",
      "OPEN": "New",
      "WORKING": "Working",
      "QUALIFIED": "Qualified",
      "LOST": "Closed",
      "CLOSED": "Closed"
    },
    "unmappedAction": "reject"
  }
  ```
- **Unmapped Actions**:
  - `reject`: Fails the row with `INVALID_ENUM_CONVERSION` reason and routes to `public.kit_rejects`.
  - `use_default`: Assigns the configured fallback default value.
  - `flag_warning`: Passes through the original value and generates an operational policy warning.
  - `pass_through`: Passes through unmapped values directly.
- **Target Enum Integrity**: If a converted value does not conform to the allowed domain enums defined in `CRM_TARGET_ENTITIES`, it is rejected by rule.

### 10.4 Named Template Save/Load & Module Scoping (`public.kit_mappings`)

- Mapping templates are persisted in `public.kit_mappings`:
  ```sql
  CREATE TABLE IF NOT EXISTS public.kit_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    target_entity TEXT NOT NULL DEFAULT 'contacts',
    mapping_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    value_conversions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by TEXT NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_kit_mappings_module_name_version UNIQUE (module, name, version)
  );
  ```
- **Exact Round-Trip**: Serializing and deserializing a template preserves all field mappings, transformations, value conversions, and metadata without loss.
- **Module Scoping**: Templates are strictly partitioned by module (e.g. `crm`, `erp`).
- **Authorization Guard**: Only authorized editors (`migration_admin`, `platform_admin`, or module-specific admins) may save or modify templates for a module domain.

### 10.5 Target Storage (`public.clean_crm`)

- Mapped target rows are staged in `public.clean_crm`:
  ```sql
  CREATE TABLE IF NOT EXISTS public.clean_crm (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.kit_batches(id) ON DELETE CASCADE,
    source_row INTEGER NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_clean_crm_batch_source_row UNIQUE (batch_id, source_row)
  );
  ```
- **Target-Only Payload**: The `payload` column contains ONLY mapped target fields (e.g., `firstName`, `lastName`, `email`). Arbitrary source columns (e.g. `extra_unmapped_source_field`) are excluded (FR-MP-05).
- **Linkage**: Foreign key linkage to `public.kit_batches(id)` and `source_row` is immutably maintained.

### 10.6 Step Completion & Outbox Event Emission

Upon completing Step 4:
1. Batch registry records the step in `public.kit_batch_steps` (step name `map`, status `mapped`).
2. Batch status in `public.kit_batches` transitions to `mapped`.
3. Outbox event `batch.mapped` is published to `public.outbox`:
   ```json
   {
     "eventType": "batch.mapped",
     "aggregateType": "kit_batch",
     "aggregateId": "BATCH_UUID",
     "correlationId": "CORRELATION_UUID",
     "producer": "migration-kit.map",
     "payload": {
       "batchId": "BATCH_UUID",
       "module": "crm",
       "mappedRows": 920,
       "missingRequired": 0,
       "templateId": "TPL_UUID",
       "templateName": "Standard CRM Contacts",
       "targetEntity": "contacts",
       "totalRows": 925,
       "durationMs": 145
     }
   }
   ```

---

## 11. Step 6: Shared Target Validation & Post-Load Integrity Engine (KIT-06)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §4.8 (FR-VA-01–04), §11.1–11.9; Project Plan v3.0 §§9, 11, 17; Issue #73 `[KIT-06]`.

### 11.1 Pipeline Stage Overview

Step 6 (**Validate**) runs module-declared validation rules against ingested, cleaned, and loaded datasets to verify both business-level and database-level integrity before signoff and reconciliation.

```
       [public.clean_crm] / Target Domain Records
                           │
                           ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ Shared Target Validation Engine                              │
    │ 1. Pre-Load Business Checks (Formats, Enums, Required)       │
    │ 2. Post-Load Referential Link Integrity (Foreign Key Target) │
    │ 3. Domain Rules (Freshness Timestamps, Cross-Field Balance)  │
    │ 4. Deterministic Checksum & Failure Attribution             │
    └──────────────────────┬───────────────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
      [All Rules Pass]            [Failures Detected]
      - State: `validated`        - State: `failed`
      - Emit `batch.validated`   - Reconciliation strictly BLOCKED
      - Proceed to Step 7         - Detailed failure report with ruleId,
                                    sourceRow, targetId, reasonCode
```

### 11.2 Typed Validation Rule Types

The validation engine supports five standardized, typed rule categories:

| Rule Type | Scope | Example | Behavior on Failure |
| :--- | :---: | :--- | :--- |
| **`required_field`** | Pre-Load | `CRM1-VAL-REQ-01`: `contacts.first_name` cannot be empty. | Fails row with `REQUIRED_FIELD_MISSING`. |
| **`format`** | Pre-Load | `CRM1-VAL-FMT-01`: `contacts.email` must match RFC email regex. | Fails row with `INVALID_FORMAT`. |
| **`enum`** | Pre-Load | `CRM1-VAL-ENUM-01`: `contacts.lead_status` in `['New', 'Working', 'Qualified', 'Closed']`. | Fails row with `INVALID_ENUM_VALUE`. |
| **`relationship`** | Post-Load | `CRM1-VAL-REL-01`: `contacts.company_id` must exist in `crm1_companies`. | Fails row with `RELATIONSHIP_NOT_FOUND` (Link integrity error). |
| **`domain`** | Pre/Post | `CRM1-VAL-DOM-01`: Non-unknown consent must have `consent_updated_at`. | Fails row with `DOMAIN_RULE_VIOLATION`. |

### 11.3 Strict Referential Link Integrity Gate

A critical non-negotiable invariant of ClearShift data reliability:
1. Every loaded record's external entity references (e.g. `order -> customer`, `deal -> contact`, `contact -> company`) are checked in post-load validation.
2. If any link integrity failure is detected:
   - The failure is explicitly recorded with `ruleId`, `sourceRow`, `targetId`, and reason `RELATIONSHIP_NOT_FOUND`.
   - The validation report is marked `isValid: false`.
   - The batch status in `public.kit_batches` transitions to `'failed'`.
   - **Reconciliation & Signoff Gate:** `ValidationService.assertBatchCanReconcile()` strictly blocks execution of Step 7 (Reconcile). No batch with failed link integrity can be signed off as successful.

### 11.4 Deterministic Output & Audit Trail

- **Determinism:** Validation failures are always sorted by `sourceRow ASC`, then `ruleId ASC`, then `field ASC`.
- **SHA-256 Checksum:** Every report calculates a cryptographic hash over the failure array. Repeated executions against the same dataset produce identical checksums.
- **Outbox Event (`batch.validated`):**
  ```json
  {
    "eventType": "batch.validated",
    "aggregateType": "kit_batch",
    "aggregateId": "BATCH_UUID",
    "payload": {
      "batch_id": "BATCH_UUID",
      "module": "crm-1",
      "total_checked": 500,
      "validation_failures": 0,
      "is_valid": true,
      "checksum": "a3f5c7...",
      "timestamp": "2026-10-23T22:30:00.000Z"
    }
  }
  ```

---

## 12. Step 5: Generic Target Adapter, Stable Idempotency & Import Receipts (KIT-08)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §11.1–11.9; Project Plan v3.0 §§9, 11, 17; Issue #75 `[KIT-08]`.

### 12.1 Pipeline Stage Overview

Step 5 (**Load**) is responsible for committing mapped and validated business entities into ClearShift target modules. To satisfy enterprise reliability and zero-data-loss guarantees under transient failures or worker crashes, all load operations adhere to the **Generic Target Adapter Contract** and **Durable Import Receipt Protocol**.

```
    [ Cleaned & Mapped Rows ]
                │
                ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ Migration Kit TargetBatchLoader                              │
    │ - Default chunk size: 500 rows                               │
    │ - Stable Idempotency Key: batchId:sourceRow:module:entity:v# │
    │ - 10% failure circuit breaker (STP-01)                       │
    └──────────────────────┬───────────────────────────────────────┘
                           │ Dispatches via TargetAdapter Port
                           ▼ (Zero Direct Target DB Privileges in Kit)
    ┌──────────────────────────────────────────────────────────────┐
    │ Target Module Adapter Port (e.g., crm-1, crm-2, crm-3)      │
    │                                                              │
    │  1. Check existing receipt by idempotencyKey                 │
    │     ├── Same Key + Same Hash ──► Return prior target ID (200)│
    │     └── Same Key + Diff Hash ──► Return Conflict 409 (Abort) │
    │                                                              │
    │  2. Domain Validation & Mutation                             │
    │                                                              │
    │  3. Single Local PostgreSQL Transaction:                     │
    │     BEGIN;                                                   │
    │       INSERT INTO <module>.<entity> (...);                   │
    │       INSERT INTO <module>.<entity>_import_receipts (...);   │
    │     COMMIT;                                                  │
    └──────────────────────────────────────────────────────────────┘
```

### 12.2 Stable Idempotency Key Derivation

Per SDS §11.4, idempotency keys MUST be stable across retries and cannot be derived from mutable payload content alone:

$$\text{idempotencyKey} = \text{SHA256}(\text{batchId} : \text{sourceRow} : \text{module} : \text{entity} : \text{v}\{\text{operationVersion}\})$$

Key invariants:
- **Stability:** The key is completely deterministic based on the source location and target operation version.
- **Payload Hash Tracking:** A canonical SHA-256 hash of the cleaned payload is computed deterministically (`computeCanonicalPayloadHash(cleanData)`) and stored alongside the receipt.
- **Payload Drift Guard:** If a retry arrives with the same idempotency key but a modified payload, the target adapter detects the hash mismatch and immediately rejects the mutation with an HTTP 409 Conflict (`IDEMPOTENCY_CONFLICT`).

### 12.3 Idempotency Replay Semantics

| Request State | Receipt Lookup | Hash Comparison | Action & Outcome |
| :--- | :--- | :--- | :--- |
| **First Attempt** | Not found | N/A | Commits business record and import receipt atomically in one transaction. Returns `targetId` and `isExisting: false`. |
| **Identical Retry** | Found | Identical | Returns previous `targetId` and existing receipt immediately. `isExisting: true`. Zero duplicate target records created. |
| **Drifted Payload Retry** | Found | Mismatch | Rejects mutation with `409 Conflict` (`IDEMPOTENCY_CONFLICT`). Original target record is protected. |
| **Worker Process Crash** | Found in DB | Identical | Worker recovers durable receipts from PostgreSQL; subsequent retries safely return prior IDs. |

### 12.4 Bounded Chunk Loading & Failure Threshold Guard

1. **500-Row Chunking:** The `TargetBatchLoader` processes records in configurable chunks (default: 500 rows) to bound memory consumption and avoid holding long-lived database locks.
2. **Circuit Breaker (10% Failure Ceiling):** If the cumulative row failure rate exceeds 10.0% ($\frac{\text{rejectedRows}}{\text{attemptedRows}} > 0.10$), the loader halts immediately:
   - Remaining rows are marked `REJECTED` with reason `STOP_THRESHOLD_EXCEEDED`.
   - Batch status in `public.kit_batches` transitions to `load_failed_partial` or `failed`.
   - Unaccounted rows are strictly guaranteed to be 0:
     $$\text{totalSourceRows} = \text{loaded} + \text{rejected} + \text{merged} + \text{skipped}$$

### 12.5 Architectural Privilege Boundary

Migration Kit operates under strict privilege separation (ADR-004 / Decision C4):
- **No Direct Table Privileges:** The Migration Kit worker role possesses ZERO insert, update, or delete privileges on module-owned domain schemas (`crm1.*`, `crm2.*`, `crm3.*`, `crm4.*`).
- **Adapter In-Process Port:** All loads are mediated via the owning module's `MigrationTargetAdapter`, ensuring that module business rules, events, and transactional boundaries are strictly respected.

---

## 13. Step 7: Terminal Outcome Ledger & Mathematically Exact Reconciliation (KIT-09)

**Traceability:** SDS ClearShift Migration Kit v2.0 §§3–4, §11.8; Project Plan v3.0 §§9, 11, 17; Issue #76 `[KIT-09]`.

### 13.1 Pipeline Stage Overview

Step 7 (**Reconcile**) executes the final accounting gate of the ClearShift Migration Pipeline. Before a batch can transition to the terminal `reconciled` status, every single source record ingested in Step 1 must be accounted for with exactly one terminal outcome in the append-only ledger `public.kit_row_outcomes`.

```
    ┌──────────────────────────────────────────────────────────────┐
    │ Source Records Ingested (Step 1: total_rows)                 │
    └──────────────────────────────┬───────────────────────────────┘
                                   │
                                   ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ Append-Only Outcome Ledger: public.kit_row_outcomes         │
    │ UNIQUE (batch_id, source_row) ── Enforced by PG Trigger      │
    ├──────────────┬───────────────┬──────────────┬────────────────┤
    │    Loaded    │   Rejected    │    Merged    │    Skipped     │
    │  (Target ID) │  (Error Code) │ (Golden ID)  │(Approved Skip) │
    └──────────────┴───────────────┴──────────────┴────────────────┘
                                   │
                                   ▼
    ┌──────────────────────────────────────────────────────────────┐
    │ Exact Mathematical Conservation Audit:                       │
    │ source = loaded + rejected + merged + skipped                │
    │ unaccounted = source - (loaded + rejected + merged + skipped)│
    └──────────────────────────────┬───────────────────────────────┘
                     ┌─────────────┴─────────────┐
                     ▼                           ▼
            [ unaccounted = 0 ]          [ unaccounted != 0 ]
            - Status: `OK`               - Status: `UNBALANCED`
            - State: `reconciled`        - State: `reconciliation_failed`
            - Signoff Enabled            - Signoff Strictly BLOCKED
```

### 13.2 The Append-Only Outcome Ledger (`kit_row_outcomes`)

- **Table Name:** `public.kit_row_outcomes`
- **Composite Unique Key:** `CONSTRAINT uq_kit_row_outcomes_batch_source_row UNIQUE (batch_id, source_row)`
  *Guarantees at database engine level that no source row can ever possess more than one terminal outcome.*
- **Immutability Trigger:** `trg_guard_kit_row_outcomes_immutable` strictly aborts any `UPDATE` or `DELETE` statement.
- **Allowed Outcomes:** Exactly one of:
  - `loaded`: Row successfully loaded into target business entity.
  - `rejected`: Row failed validation, cleaning, or target constraints.
  - `merged`: Row deterministically linked into a golden master entity.
  - `skipped`: Row intentionally excluded via operator-approved skip protocol.

### 13.3 Operator-Approved Skip Policy

Per ClearShift Core Rules & Decision KIT-09, row skipping is strictly audited and constrained:
1. **Timing Window:** Permitted **only before real load** (during `extracting`, `extracted`, `profiled`, `cleaned`, `mapped`, or `dry_run_passed`). Attempting to skip rows during or after load raises `InvalidSkipApprovalError` (HTTP 400).
2. **Role Authorization:** Only users with `editor`, `migration_admin`, or `platform_admin` roles can approve skips. **A Migration Runner cannot approve its own skip** (HTTP 403 Forbidden).
3. **Reason Justification:** The operator must supply a substantive explanation of at least **10 non-whitespace characters** (`reason.trim().length >= 10`).
4. **Policy Audit Trail:** Every skip records:
   - `actor`: Identifying username / ID of the operator.
   - `approved_by`: Confirmed approving editor/admin.
   - `approved_at`: UTC timestamp of approval.
   - `policy_code`: `'operator_approved_skip'`.
5. **Dry-Run Token Invalidation:** If a row is skipped while the batch is in `dry_run_passed`, the existing dry-run token is automatically invalidated, requiring a fresh dry-run before real load is permitted.
6. **Ignored Columns Policy:** Unmapping or ignoring a column NEVER marks a row as skipped. Ignored columns simply pass through without target field mapping; the row itself is processed and recorded as `loaded` or `rejected`.

### 13.4 Mathematical Conservation Equation

All counts derive **strictly from the outcome ledger (`public.kit_row_outcomes`)**, NEVER from target table row counts or dirty heuristic projections:

$$\text{sourceRows} = \text{loadedCount} + \text{rejectedCount} + \text{mergedCount} + \text{skippedCount}$$

$$\text{unaccountedCount} = \text{sourceRows} - (\text{loadedCount} + \text{rejectedCount} + \text{mergedCount} + \text{skippedCount}) = 0$$

- **Balanced State (`OK`):** When $\text{unaccountedCount} = 0$, the batch is certified balanced and signoff is unlocked.
- **Unbalanced State (`UNBALANCED`):**
  - **Missing Rows:** If accounted rows are fewer than source rows ($\text{unaccounted} > 0$).
  - **Double-Count Fixture:** If accounted rows exceed source rows ($\text{unaccounted} < 0$), e.g. from duplicate fixtures or broken concurrency.
  - In either unbalanced case, the batch state transitions to `reconciliation_failed`, and signoff is blocked with `ReconciliationInvariantError` (HTTP 422).

### 13.5 Reconciliation Verification Queries

To inspect outcome conservation directly in PostgreSQL:

```sql
-- 1. Derive terminal outcome counts from ledger
SELECT
    batch_id,
    COUNT(*) FILTER (WHERE outcome = 'loaded') AS loaded_count,
    COUNT(*) FILTER (WHERE outcome = 'rejected') AS rejected_count,
    COUNT(*) FILTER (WHERE outcome = 'merged') AS merged_count,
    COUNT(*) FILTER (WHERE outcome = 'skipped') AS skipped_count,
    COUNT(*) AS total_accounted
FROM public.kit_row_outcomes
WHERE batch_id = 'BATCH_UUID'
GROUP BY batch_id;

-- 2. Compare against batch source total
SELECT
    b.id,
    b.batch_number,
    b.total_rows AS source_count,
    COUNT(o.id) AS accounted_count,
    (b.total_rows - COUNT(o.id)) AS unaccounted_count,
    CASE
        WHEN b.total_rows = COUNT(o.id) THEN 'OK'
        ELSE 'UNBALANCED'
    END AS reconciliation_status
FROM public.kit_batches b
LEFT JOIN public.kit_row_outcomes o ON b.id = o.batch_id
WHERE b.id = 'BATCH_UUID'
GROUP BY b.id, b.batch_number, b.total_rows;
```

