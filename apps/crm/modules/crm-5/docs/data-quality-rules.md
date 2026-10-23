# CRM-5 Data Quality Rules
Ruleset version: 1. Fixture: `sample-data/crm-5/dirty-data-v1.csv` (checksum in `expected-profile.json`).

Raw input is never modified. Rules run on a trimmed copy (enum fields and `id` lowercased, embedded whitespace in `batch_id` replaced with `-`). Exact matching only: no fuzzy matching and no destructive merge: in-file exact duplicates keep the first row and count later rows as `merged` (raw rows are kept); duplicates against existing target data go to human review. A row takes the highest-precedence outcome: `reject` > `merge` > `normalize` > `accept`.

| rule_id | v | field | outcome | code | input condition | reason |
|---|---|---|---|---|---|---|
| CRM5-DQ-001 | 1 | batch_id | reject | REQUIRED_FIELD_MISSING | batch_id empty after trim | batch_id is required |
| CRM5-DQ-002 | 1 | module | reject | REQUIRED_FIELD_MISSING | module empty after trim | module is required |
| CRM5-DQ-003 | 1 | step | reject | REQUIRED_FIELD_MISSING | step empty after trim | step is required |
| CRM5-DQ-004 | 1 | id | reject | MALFORMED_UUID | id present and not a lowercase-normalized UUID | id must be a valid UUID |
| CRM5-DQ-005 | 1 | status | reject | INVALID_ENUM_VALUE | status present and not in allowlist | status must be one of the run status allowlist |
| CRM5-DQ-006 | 1 | module | reject | FOREIGN_KEY_MISSING | module present and not a registered CRM module | module is not registered in the ClearShift module registry |
| CRM5-DQ-007 | 1 | step | reject | INVALID_ENUM_VALUE | step present and not in allowlist | step must be one of the migration step allowlist |
| CRM5-DQ-008 | 1 | batch_id | reject | FORMULA_PREFIX | raw batch_id starts with = + - or @ | spreadsheet formula prefixes are not allowed |
| CRM5-DQ-009 | 1 | batch_id | reject | FOREIGN_KEY_MISSING | safe batch_id not found in Kit batch ledger | referenced batch does not exist in the Kit batch ledger |
| CRM5-DQ-010 | 1 | records_in | reject | OUT_OF_BOUNDS | records_in/out/rejected not an integer in 0..2147483647 | record counts must be non-negative 32-bit integers |
| CRM5-DQ-011 | 1 | records_out | reject | COUNT_INVARIANT_VIOLATION | records_out + records_rejected > records_in | out plus rejected cannot exceed in |
| CRM5-DQ-012 | 1 | started_at | reject | INVALID_TIMESTAMP | started_at present and not ISO-8601 with time and offset | started_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z) |
| CRM5-DQ-013 | 1 | completed_at | reject | INVALID_TIMESTAMP | completed_at present and not ISO-8601 with time and offset | completed_at must be ISO-8601 (YYYY-MM-DDThh:mm:ss[.fff]Z) |
| CRM5-DQ-014 | 1 | completed_at | reject | CHRONOLOGY_VIOLATION | completed_at earlier than started_at | completed_at cannot precede started_at |
| CRM5-DQ-015 | 1 | metadata | reject | MALFORMED_JSON | metadata present and not valid JSON | metadata must be valid JSON |
| CRM5-DQ-016 | 1 | batch_id | normalize | WHITESPACE_NORMALIZED | leading/trailing whitespace or embedded tabs in batch_id, module, step or status | whitespace trimmed, embedded batch_id whitespace replaced with "-", enum fields lowercased; raw value preserved |
| CRM5-DQ-017 | 1 | id | merge | DUPLICATE_EXACT | id already seen earlier in the batch | exact duplicate id; first row wins, later rows counted as merged, raw rows kept |
| CRM5-DQ-018 | 1 | batch_id | merge | DUPLICATE_EXACT | (batch_id, step) already seen earlier in the batch | exact duplicate natural key; first row wins, later rows counted as merged, raw rows kept |

## Fields

Required: `batch_id`, `module`, `step`. Optional: `id`, `status` (default `pending`), `records_in`, `records_out`, `records_rejected` (default 0), `started_at`, `completed_at`, `metadata`.

Enumerations: `module` (CRM module registry), `step` (extract, profile, clean, map, load, validate, reconcile), `status` (pending, running, completed, failed, halted).

Duplicate candidate keys: `id`; `(batch_id, step)`. Relationship: `batch_id` must exist in the Kit batch ledger, `module` in the module registry.

Source-to-target mapping: `sample-data/crm-5/mapping-template.json`.
