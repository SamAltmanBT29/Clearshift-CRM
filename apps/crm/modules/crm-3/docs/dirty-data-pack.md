# CRM-3 Support Tickets and Activities — Dirty Data Pack Strategy Plan

**Module:** CRM-3 Support Tickets and Activities
**Version:** V1
**Traceability:** SDS ClearShift CRM v2.0 §4.4; V1 Standardization Plan; Issue #157 [CRM3-24]

> **Rule:** All test data is 100% synthetic. No real personal, customer, or employee data is permitted in any fixture, seed file, or test case. All names, emails, phone numbers, and identifiers used in examples are fictional.

---

## 1. Purpose

The Dirty Data Pack (DDP) is the canonical collection of synthetic edge-case inputs that exercise the CRM-3 data pipeline under adversarial conditions. The DDP:

1. **Verifies** that the Migration Kit Target Adapter rejects invalid rows with the correct reason codes.
2. **Measures** the expected defect distribution across defect categories to establish a quality baseline.
3. **Proves** that the profiling, cleaning, and mapping pipeline correctly identifies and quarantines dirty records.
4. **Provides** regression fixtures that prevent defect re-introductions.

---

## 2. Defect Taxonomy

| Category | Code | Description |
| :--- | :--- | :--- |
| Subject defects | `E-SUB` | Missing, blank, or whitespace-only subject |
| Status defects | `E-STA` | Invalid, wrong-case, or empty status value |
| Priority defects | `E-PRI` | Invalid, wrong-case, or empty priority value |
| Contact defects | `E-CON` | Missing contact reference, unresolvable email |
| Duplicate defects | `E-DUP` | Duplicate source key, duplicate within batch |
| Timestamp defects | `E-TS` | Invalid ISO 8601, future timestamp, null required ts |
| Note defects | `E-NOTE` | Blank note text, orphan note (ticket missing) |
| Idempotency defects | `E-IMP` | Key reuse with different payload |
| Structural defects | `E-STR` | Missing required fields, extra unknown fields |
| Encoding defects | `E-ENC` | Null bytes, non-UTF-8 sequences, control characters |

---

## 3. Dirty Ticket Scenarios

### 3.1 Subject Field Defects (E-SUB)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-01 | `subject: ""` (empty string) | REJECT | `EMPTY_SUBJECT` |
| DDP-T-02 | `subject: "   "` (spaces only) | REJECT | `EMPTY_SUBJECT` |
| DDP-T-03 | `subject: "\t\n"` (tab + newline) | REJECT | `EMPTY_SUBJECT` |
| DDP-T-04 | `subject` field missing entirely | REJECT | `EMPTY_SUBJECT` |
| DDP-T-05 | `subject: null` | REJECT | `EMPTY_SUBJECT` |
| DDP-T-06 | `subject: "  valid subject  "` (leading/trailing spaces) | LOAD (after trim) | — |

### 3.2 Status Field Defects (E-STA)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-07 | `status: "open"` (lowercase) | REJECT | `INVALID_STATUS` |
| DDP-T-08 | `status: "OPEN"` (uppercase) | REJECT | `INVALID_STATUS` |
| DDP-T-09 | `status: "Pending"` (invalid value) | REJECT | `INVALID_STATUS` |
| DDP-T-10 | `status: "Resolved"` (legacy alias) | REJECT | `INVALID_STATUS` |
| DDP-T-11 | `status: ""` (empty string) | REJECT | `INVALID_STATUS` |
| DDP-T-12 | `status` field missing entirely | REJECT (or use default `New`) | `INVALID_STATUS` / defaults to `New` |
| DDP-T-13 | `status: "New"` (valid) | LOAD | — |
| DDP-T-14 | `status: "Closed"` (import allows terminal status) | LOAD | — |

### 3.3 Priority Field Defects (E-PRI)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-15 | `priority: "high"` (lowercase) | REJECT | `INVALID_PRIORITY` |
| DDP-T-16 | `priority: "Critical"` (non-existent value) | REJECT | `INVALID_PRIORITY` |
| DDP-T-17 | `priority: "P1"` (legacy numeric code) | REJECT | `INVALID_PRIORITY` |
| DDP-T-18 | `priority: ""` (empty string) | REJECT | `INVALID_PRIORITY` |
| DDP-T-19 | `priority: "Urgent"` (valid) | LOAD | — |

### 3.4 Contact Reference Defects (E-CON)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-20 | `customerEmail: "notexist@synthetic.example.com"` (not in CRM-1) | REJECT | `CUSTOMER_UNRESOLVED` |
| DDP-T-21 | `customerEmail: ""` (empty email) | REJECT | `INVALID_EMAIL` |
| DDP-T-22 | `customerEmail: "not-an-email"` (malformed) | REJECT | `INVALID_EMAIL` |
| DDP-T-23 | `customerEmail` field missing entirely | REJECT | `INVALID_EMAIL` |
| DDP-T-24 | `customerEmail: "test@synthetic.example.com"` (exists in CRM-1) | LOAD | — |
| DDP-T-25 | `customerEmail: "TEST@SYNTHETIC.EXAMPLE.COM"` (uppercase, resolved after normalize) | LOAD | — |

### 3.5 Duplicate Source Key Defects (E-DUP)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-26 | Row with `(source_system, source_id)` already in DB | REJECT | `DUPLICATE_SOURCE_KEY` |
| DDP-T-27 | Two rows in same batch with identical `(source_system, source_id)` | Second row REJECT | `DUPLICATE_SOURCE_KEY` |
| DDP-T-28 | `source_system` present but `source_id` absent (mismatched pair) | REJECT | `INVALID_ROW` |
| DDP-T-29 | `source_system: ""` (empty, with source_id set) | REJECT | `INVALID_ROW` |

### 3.6 Idempotency Defects (E-IMP)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-30 | Same idempotency key + same canonical payload (exact replay) | Returns existing receipt; no double-write | — |
| DDP-T-31 | Same idempotency key + different `subject` (payload changed) | REJECT | `IDEMPOTENCY_CONFLICT` |
| DDP-T-32 | Batch `idempotency_key` set but `request_hash` missing | REJECT | `INVALID_ROW` |

### 3.7 Structural / Encoding Defects (E-STR, E-ENC)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-T-33 | Row with completely empty object `{}` | REJECT | `INVALID_ROW` |
| DDP-T-34 | Row with unknown extra fields | LOAD (extras ignored, strict schema mode) | — |
| DDP-T-35 | `subject` containing null byte `\u0000` | REJECT | `INVALID_ROW` |
| DDP-T-36 | `subject` containing only emoji `"🎫"` (valid non-whitespace) | LOAD | — |
| DDP-T-37 | Non-UUID `batch_id` format | REJECT | `INVALID_BATCH_ID` |
| DDP-T-38 | `source_row: 0` (zero, must be > 0) | REJECT | `INVALID_SOURCE_ROW` |
| DDP-T-39 | `source_row: -1` (negative) | REJECT | `INVALID_SOURCE_ROW` |

---

## 4. Dirty Note Scenarios

### 4.1 Note Content Defects (E-NOTE)

| Scenario ID | Input | Expected Outcome | Reason Code |
| :--- | :--- | :--- | :--- |
| DDP-N-01 | `note_text: ""` (empty) | REJECT | `EMPTY_NOTE_TEXT` |
| DDP-N-02 | `note_text: "   "` (whitespace only) | REJECT | `EMPTY_NOTE_TEXT` |
| DDP-N-03 | `note_text` field missing | REJECT | `VALIDATION_ERROR` |
| DDP-N-04 | Note referencing non-existent `ticket_id` | REJECT | `ticket_not_found` |
| DDP-N-05 | `author_id: ""` (empty) | REJECT | `VALIDATION_ERROR` |

---

## 5. Expected Defect Distribution

Based on analysis of legacy support ticket exports from comparable projects, the expected defect distribution for the CRM-3 module is:

| Defect Category | Expected Rate | Description |
| :--- | :---: | :--- |
| Valid records (clean load) | ~70% | Records that pass all validation |
| Subject defects (E-SUB) | ~8% | Empty or whitespace subjects from legacy exports |
| Status value defects (E-STA) | ~6% | Wrong-case or legacy status aliases |
| Contact unresolvable (E-CON) | ~7% | Customer email not found in CRM-1 golden records |
| Priority value defects (E-PRI) | ~3% | Legacy priority codes (P1/P2/P3 style) |
| Duplicate source keys (E-DUP) | ~3% | Re-exported rows from incremental exports |
| Structural / encoding defects (E-STR/E-ENC) | ~2% | Malformed rows from CSV parse errors |
| Idempotency conflicts (E-IMP) | ~1% | Duplicate batch submissions |

**Total expected reject rate:** ~30% of imported rows.

> **Reconciliation formula (enforced by CRM-5):**
> `Source Count = Loaded + Rejected` (no silent drops)

---

## 6. Synthetic Fixture File Plan

The following files will be created under `apps/crm/modules/crm-3/tests/fixtures/dirty-data/`:

| File | Rows | Description |
| :--- | :---: | :--- |
| `crm3-tickets-valid.csv` | 50 | 100% clean rows for baseline / happy-path tests |
| `crm3-tickets-dirty.csv` | 70 | Mixed dirty rows covering all E-SUB, E-STA, E-PRI, E-CON, E-DUP scenarios |
| `crm3-tickets-boundary.csv` | 20 | Edge cases: max-length strings, emoji, special characters, boundary timestamps |
| `crm3-notes-dirty.csv` | 20 | Invalid notes: blank text, missing ticket, wrong author |
| `crm3-import-expected.json` | — | Expected `loaded_count`, `rejected_count`, and per-row outcomes for each CSV |
| `crm3-contacts-seed.json` | 30 | Synthetic CRM-1 contacts to seed the resolver mock for tests |

---

## 7. Synthetic Data Generation Rules

All synthetic data must comply with:

1. **No real data:** Names use the pattern `Synthetic <N>`, emails use `@synthetic.example.com` or `@test.clearshift.internal`.
2. **Deterministic:** Fixtures are static files checked into source control — not generated at test runtime — to ensure reproducibility.
3. **UUID format:** All IDs are valid UUIDs. Source IDs use format `syn_ticket_<NNN>` or `syn_note_<NNN>`.
4. **Timestamps:** All timestamps are ISO 8601 UTC with millisecond precision (e.g., `2026-01-15T10:30:00.000Z`). No locale-specific formats.
5. **Enumeration coverage:** At least one row for every valid enum value (all 5 statuses, all 4 priorities).
6. **Boundary values:** Include at least one row at expected string length boundaries (1 char, 255 chars, 500 chars).

---

## 8. Integration with Profiling & Cleaning Pipeline

The Dirty Data Pack feeds directly into the CRM-3 migration pipeline stages:

```
crm3-tickets-dirty.csv
        │
        ▼
  [Step 1: Profiling]    ← CRM3-26 — Profile config identifies defect categories
        │ outputs: profile report (null counts, invalid values, duplicate rate)
        ▼
  [Step 2: Cleaning]     ← CRM3-27 — Normalize status/priority, trim subject
        │ outputs: clean rows + reject rows with reason codes
        ▼
  [Step 3: Mapping]      ← CRM3-28 — Map legacy field names to canonical schema
        │ outputs: mapped rows ready for Target Adapter
        ▼
  [Step 4: Load]         ← CRM3-11 — Crm3TargetAdapter writes to crm3 schema
        │ outputs: loaded_count + rejected_count + receipts
        ▼
  [Step 5: Reconcile]    ← CRM-5 — Source = Loaded + Rejected (verified)
```

---

## 9. Acceptance Gate Checklist

For Gate G1 sign-off:

- [ ] All 39 dirty ticket scenarios (DDP-T-01 .. DDP-T-39) documented with expected outcome.
- [ ] All 5 dirty note scenarios (DDP-N-01 .. DDP-N-05) documented.
- [ ] Expected defect distribution established and agreed by QA lead.
- [ ] Synthetic fixture file plan defined (filenames, row counts, format).
- [ ] Synthetic data generation rules documented.
- [ ] No real personal or customer data present in any fixture.

---

*Traceability: Issue #157 [CRM3-24]. Gate G1 — Design Complete. Last updated: 2026-10-24.*
