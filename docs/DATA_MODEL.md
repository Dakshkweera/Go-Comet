# Data Model
## GoComet Nova — Part 1: Multi-Agent Trade Document Pipeline

**Status:** Implementation-ready  
**Audience:** Claude Code / engineering implementation  
**Scope:** Part 1 only  
**Related documents:** `PRD.md`, `ARCHITECTURE.md`, `TECHNICAL_DESIGN.md`, `DECISIONS.md`

---

# 1. Purpose

This document defines the persistent data model for the Part 1 POC.

The database must preserve enough information to answer:

1. What document was processed?
2. Which pipeline run processed it?
3. What did the Extractor find?
4. What confidence/evidence did it provide?
5. Which customer was resolved?
6. Which customer rules were loaded?
7. What did validation find?
8. What final decision was made?
9. Why was that decision made?
10. Where was the pipeline when a failure occurred?
11. Can the run resume after a crash?
12. Can the Query Layer answer basic questions from stored data?

The database is therefore both:

- a **business-data store**
- a **durable pipeline-state store**

SQLite is the chosen database for the POC.

---

# 2. Data Model Principles

## 2.1 Persist facts separately from decisions

Extraction answers:

> What did the document say?

Validation answers:

> Does the extracted information satisfy the rules?

Decision answers:

> What should happen next?

These should remain distinguishable in storage.

---

## 2.2 Preserve evidence

Where available, store extraction evidence alongside:

- extracted value
- confidence

This makes the run inspectable.

---

## 2.3 Persist the rules used

A run should be understandable later even if customer rules change.

Therefore the system should persist which rules were applied to the run.

The implementation may store a rule snapshot or a sufficiently complete reference/versioned representation.

For this POC, a rule snapshot is preferred for auditability.

---

## 2.4 Persist stage state

Pipeline state must survive application crashes.

Example:

```text
RECEIVED
   ↓
EXTRACTED
   ↓
application crash
```

After restart, the system should know extraction already completed.

---

## 2.5 Avoid unnecessary duplication

Use normalized relational tables for reusable entities such as:

- customers
- customer rules

Use run-specific tables for:

- extraction results
- validation results
- decisions

---

# 3. Entity Overview

The primary entities are:

```text
customers
    │
    └── customer_rules
           │
           │
documents ─┴── pipeline_runs
                │
                ├── extractions
                ├── validation_results
                └── decisions
```

Additional optional operational information can be represented through pipeline stage records or columns on `pipeline_runs`.

---

# 4. Entity List

| Entity | Purpose |
|---|---|
| `customers` | Customer master data |
| `customer_rules` | Configured validation rules for customers |
| `documents` | Uploaded trade documents |
| `pipeline_runs` | One processing attempt/workflow for a document |
| `extractions` | Extracted field values and confidence |
| `validation_results` | Field-level rule evaluation |
| `decisions` | Final operational decision and reasoning |
| `pipeline_stage_runs` | Optional detailed stage execution history |

The first seven entities are required for the POC.

`pipeline_stage_runs` is recommended because it improves observability and retry/debugging.

---

# 5. `customers`

Stores customer identities used for rule resolution.

## Columns

```text
id
name
normalized_name
created_at
updated_at
```

### Suggested SQL

```sql
CREATE TABLE customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

---

## Column meanings

### `id`

Stable application-generated customer ID.

Example:

```text
cust_bata_india
```

### `name`

Human-readable customer name.

Example:

```text
Bata India
```

### `normalized_name`

Canonical lookup form.

Example:

```text
bata india
```

The resolver should normalize input before lookup.

### `created_at`

Creation timestamp.

### `updated_at`

Last modification timestamp.

---

# 6. `customer_rules`

Stores customer-specific validation requirements.

## Columns

```text
id
customer_id
field
operator
expected_value
min_value
max_value
unit
is_active
created_at
updated_at
```

Suggested SQL:

```sql
CREATE TABLE customer_rules (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    field TEXT NOT NULL,
    operator TEXT NOT NULL,
    expected_value TEXT,
    min_value REAL,
    max_value REAL,
    unit TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (customer_id)
        REFERENCES customers(id)
);
```

---

# 7. Rule Operators

The initial supported operators are:

```text
EXACT
MIN
MAX
RANGE
```

Example:

```text
field: incoterms
operator: EXACT
expected_value: FOB
```

Example:

```text
field: gross_weight
operator: MAX
max_value: 1000
unit: kg
```

Example:

```text
field: gross_weight
operator: RANGE
min_value: 500
max_value: 1000
unit: kg
```

---

# 8. Rule Constraints

Application-level validation must enforce valid combinations.

Examples:

### EXACT

Requires:

```text
expected_value
```

### MIN

Requires:

```text
min_value
```

### MAX

Requires:

```text
max_value
```

### RANGE

Requires:

```text
min_value
max_value
```

Do not silently interpret malformed rules.

Invalid rule configuration should prevent safe automatic approval.

---

# 9. `documents`

Represents the uploaded source document.

## Columns

```text
id
original_filename
mime_type
file_size
storage_path
content_hash
created_at
```

Suggested SQL:

```sql
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    content_hash TEXT,
    created_at TEXT NOT NULL
);
```

---

# 10. Document Storage

The POC does not need to store binary document contents inside SQLite.

Prefer:

```text
filesystem/object storage
       +
SQLite metadata
```

SQLite stores:

```text
storage_path
content_hash
metadata
```

This keeps the database small and simple.

The exact storage directory should be configurable.

Example:

```text
data/uploads/<document-id>.pdf
```

Do not commit uploaded customer documents to the repository unless they are intentionally provided as sanitized sample data.

---

# 11. `pipeline_runs`

This is the central entity.

One `pipeline_run` represents one processing workflow for one document.

## Columns

```text
id
document_id
status
current_stage
customer_id
customer_resolution_status
customer_resolution_reason
final_decision
final_reasoning
attempt_count
error_code
error_message
created_at
updated_at
completed_at
```

Suggested SQL:

```sql
CREATE TABLE pipeline_runs (
    id TEXT PRIMARY KEY,

    document_id TEXT NOT NULL,

    status TEXT NOT NULL,
    current_stage TEXT NOT NULL,

    customer_id TEXT,
    customer_resolution_status TEXT,
    customer_resolution_reason TEXT,

    final_decision TEXT,
    final_reasoning TEXT,

    attempt_count INTEGER NOT NULL DEFAULT 0,

    error_code TEXT,
    error_message TEXT,

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,

    FOREIGN KEY (document_id)
        REFERENCES documents(id),

    FOREIGN KEY (customer_id)
        REFERENCES customers(id)
);
```

---

# 12. Pipeline Status

Recommended run statuses:

```text
RECEIVED
PROCESSING
COMPLETED
FAILED
```

The detailed stage is stored separately in `current_stage`.

This keeps:

```text
overall run status
```

separate from:

```text
current processing stage
```

---

# 13. Pipeline Stages

Recommended stages:

```text
RECEIVED
EXTRACTING
EXTRACTED
CUSTOMER_RESOLVING
CUSTOMER_RESOLVED
VALIDATING
VALIDATED
ROUTING
ROUTED
COMPLETED
```

Terminal state:

```text
COMPLETED
```

Failure can occur from any processing stage.

---

# 14. Customer Resolution Status

Recommended values:

```text
resolved
not_found
ambiguous
not_attempted
```

Examples:

```text
resolved
    customer_id = cust_bata_india

not_found
    customer_id = null

ambiguous
    customer_id = null
```

Never silently select one customer from an ambiguous result.

---

# 15. Final Decision

Recommended values:

```text
auto_approve
human_review
amendment_request
```

These correspond directly to the three required operational outcomes.

No additional final decision should be introduced without updating the PRD and architecture.

---

# 16. `extractions`

Stores field-level extraction results for a pipeline run.

A row represents one extracted field.

## Columns

```text
id
run_id
field_name
value_text
value_number
unit
confidence
evidence
created_at
```

Suggested SQL:

```sql
CREATE TABLE extractions (
    id TEXT PRIMARY KEY,

    run_id TEXT NOT NULL,

    field_name TEXT NOT NULL,

    value_text TEXT,
    value_number REAL,
    unit TEXT,

    confidence REAL NOT NULL,

    evidence TEXT,

    created_at TEXT NOT NULL,

    FOREIGN KEY (run_id)
        REFERENCES pipeline_runs(id)
);
```

---

# 17. Extraction Field Names

The initial required fields are:

```text
consignee_name
hs_code
port_of_loading
port_of_discharge
incoterms
description_of_goods
gross_weight
invoice_number
```

These should be represented as application-level constants/enums where practical.

---

# 18. Why Separate `value_text` and `value_number`?

Different extracted fields have different types.

Examples:

```text
invoice_number → text

hs_code → text

incoterms → text

gross_weight → number
```

Using separate columns avoids treating numeric values as arbitrary strings when deterministic validation needs numeric comparison.

Example:

```text
value_number = 1200
unit = kg
```

For a text field:

```text
value_text = "FOB"
```

Only the appropriate value column should be populated.

---

# 19. Null Extraction

A missing value should be represented as:

```text
value_text = NULL
value_number = NULL
```

rather than inventing a placeholder such as:

```text
"N/A"
"unknown"
"not found"
```

The application knows that both value columns being null means no extracted value exists.

---

# 20. Confidence

Store confidence as a numeric value between:

```text
0.0
1.0
```

Database/application validation must enforce:

```text
0 <= confidence <= 1
```

Important:

This value is a model-reported uncertainty signal, not automatically a calibrated probability.

---

# 21. Evidence

`evidence` contains a short model-provided reference to the document content supporting the extracted value.

Example:

```text
CONSIGNEE: Bata India
```

Evidence should not be fabricated by application code.

If useful evidence is unavailable:

```text
NULL
```

---

# 22. Extraction Uniqueness

For the basic POC, one run should have at most one final extraction result for each required field.

Recommended uniqueness:

```sql
UNIQUE(run_id, field_name)
```

This can be implemented as a unique constraint/index.

If extraction attempts need to be retained historically, use a separate attempt table rather than creating duplicate final extraction rows.

---

# 23. `validation_results`

Stores field-level validation outcomes.

## Columns

```text
id
run_id
field_name
status
found_text
found_number
expected_text
expected_number
expected_min
expected_max
unit
rule_id
reason
created_at
```

Suggested SQL:

```sql
CREATE TABLE validation_results (
    id TEXT PRIMARY KEY,

    run_id TEXT NOT NULL,

    field_name TEXT NOT NULL,

    status TEXT NOT NULL,

    found_text TEXT,
    found_number REAL,

    expected_text TEXT,
    expected_number REAL,

    expected_min REAL,
    expected_max REAL,

    unit TEXT,

    rule_id TEXT,

    reason TEXT NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY (run_id)
        REFERENCES pipeline_runs(id),

    FOREIGN KEY (rule_id)
        REFERENCES customer_rules(id)
);
```

---

# 24. Validation Status

Only:

```text
match
mismatch
uncertain
```

should be used.

Do not add:

```text
missing
```

as a validation status.

Missing extraction is represented by the extraction layer.

The Validator can produce:

```text
uncertain
```

when a required value cannot be reliably evaluated.

---

# 25. Why Store `found` and `expected` Separately?

A reviewer needs to understand a mismatch without reconstructing it.

Example:

```text
field_name:
gross_weight

status:
mismatch

found_number:
1200

expected_max:
1000

unit:
kg
```

The UI can therefore show:

```text
Found: 1200 kg
Expected: <= 1000 kg
```

---

# 26. Why Store `rule_id`?

A validation result should identify the rule that produced it.

This makes the run traceable:

```text
document
   ↓
extraction
   ↓
rule
   ↓
validation
```

For long-term auditability, the rule's relevant values should also be snapshotted or versioned.

---

# 27. Rule Snapshot

Customer rules may change after a run.

If the application only stores:

```text
rule_id
```

then historical interpretation can become ambiguous.

For the POC, preserve the rule values used during validation.

Options:

### Option A — Rule snapshot columns in validation

Store:

```text
operator
expected
min
max
unit
```

on `validation_results`.

### Option B — Versioned rules

Add:

```text
version
```

to `customer_rules`.

The POC can use Option A because it is simple and makes the validation result self-contained.

---

# 28. `decisions`

Stores the final Router output.

## Columns

```text
id
run_id
decision
reasoning
created_at
```

Suggested SQL:

```sql
CREATE TABLE decisions (
    id TEXT PRIMARY KEY,

    run_id TEXT NOT NULL,

    decision TEXT NOT NULL,

    reasoning TEXT NOT NULL,

    created_at TEXT NOT NULL,

    FOREIGN KEY (run_id)
        REFERENCES pipeline_runs(id)
);
```

---

# 29. Decision Uniqueness

A completed run should have exactly one final decision.

Recommended:

```sql
UNIQUE(run_id)
```

If decision attempts need to be historically tracked, use a separate decision-attempt table.

For this POC, one final decision row is sufficient.

---

# 30. `pipeline_stage_runs`

This table is recommended for detailed execution history.

It allows us to answer:

- Which stage ran?
- How many attempts?
- How long did it take?
- Did it fail?
- Was it retryable?

## Columns

```text
id
run_id
stage
attempt
status
started_at
completed_at
error_code
error_message
metadata_json
```

Suggested SQL:

```sql
CREATE TABLE pipeline_stage_runs (
    id TEXT PRIMARY KEY,

    run_id TEXT NOT NULL,

    stage TEXT NOT NULL,

    attempt INTEGER NOT NULL,

    status TEXT NOT NULL,

    started_at TEXT NOT NULL,
    completed_at TEXT,

    error_code TEXT,
    error_message TEXT,

    metadata_json TEXT,

    FOREIGN KEY (run_id)
        REFERENCES pipeline_runs(id)
);
```

---

# 31. Stage Run Status

Recommended:

```text
running
succeeded
failed
```

A retry creates a new stage-run record:

```text
EXTRACTING attempt 1 → failed
EXTRACTING attempt 2 → succeeded
```

This is preferable to overwriting the first attempt.

---

# 32. Stage Metadata

`metadata_json` can contain non-business operational metadata such as:

```json
{
  "model": "candidate-model",
  "latencyMs": 3240
}
```

Do not store secrets.

Do not store the entire document unnecessarily.

Do not use `metadata_json` as a substitute for proper relational fields required by the product.

---

# 33. Foreign Key Relationships

Conceptually:

```text
customers
   │
   ├───────────────┐
   │               │
   ▼               ▼
customer_rules   pipeline_runs
                    │
                    ├────────── documents
                    │
                    ├────────── extractions
                    │
                    ├────────── validation_results
                    │
                    ├────────── decisions
                    │
                    └────────── pipeline_stage_runs
```

More precisely:

```text
customers 1 ─── N customer_rules

customers 1 ─── N pipeline_runs

documents 1 ─── N pipeline_runs

pipeline_runs 1 ─── N extractions

pipeline_runs 1 ─── N validation_results

pipeline_runs 1 ─── 1 decisions

pipeline_runs 1 ─── N pipeline_stage_runs
```

---

# 34. Recommended Indexes

## Customers

```sql
CREATE UNIQUE INDEX idx_customers_normalized_name
ON customers(normalized_name);
```

## Customer rules

```sql
CREATE INDEX idx_customer_rules_customer
ON customer_rules(customer_id);
```

## Pipeline runs

```sql
CREATE INDEX idx_pipeline_runs_status
ON pipeline_runs(status);

CREATE INDEX idx_pipeline_runs_decision
ON pipeline_runs(final_decision);

CREATE INDEX idx_pipeline_runs_created_at
ON pipeline_runs(created_at);

CREATE INDEX idx_pipeline_runs_customer
ON pipeline_runs(customer_id);
```

## Extractions

```sql
CREATE INDEX idx_extractions_run
ON extractions(run_id);

CREATE UNIQUE INDEX idx_extractions_run_field
ON extractions(run_id, field_name);
```

## Validation

```sql
CREATE INDEX idx_validation_run
ON validation_results(run_id);

CREATE INDEX idx_validation_status
ON validation_results(status);
```

## Stage history

```sql
CREATE INDEX idx_stage_runs_run
ON pipeline_stage_runs(run_id);
```

---

# 35. Timestamps

Store timestamps consistently.

Recommended representation:

```text
ISO 8601 UTC
```

Example:

```text
2026-09-29T16:30:00.000Z
```

Do not mix local timestamps and UTC timestamps inside the database.

The UI can convert to local time for display.

---

# 36. IDs

Use stable application-generated IDs.

For example:

```text
doc_<id>
run_<id>
cust_<id>
rule_<id>
ext_<id>
val_<id>
decision_<id>
stage_<id>
```

UUIDs are also acceptable.

The exact ID library is an implementation choice.

The important requirements are:

- unique
- stable
- non-sequential if exposing IDs publicly is a concern

---

# 37. Seed Customer

The POC should have at least one customer.

Example:

```text
Customer:
Bata India
```

Customer ID:

```text
cust_bata_india
```

---

# 38. Seed Rules

Suggested POC rules:

```text
HS Code
EXACT
640399

Port of Loading
EXACT
Shanghai

Port of Discharge
EXACT
Mumbai

Incoterms
EXACT
FOB

Gross Weight
MAX
1000 kg
```

These rules create useful demo scenarios.

---

# 39. Clean Scenario

Example extracted data:

```text
Consignee: Bata India
HS Code: 640399
Port Loading: Shanghai
Port Discharge: Mumbai
Incoterms: FOB
Gross Weight: 900 kg
Invoice: INV-2026-1042
```

Expected:

```text
Validation:
all required rules → match

Decision:
auto_approve
```

---

# 40. Amendment Scenario

Example:

```text
Consignee: Bata India
HS Code: 640399
Port Loading: Shanghai
Port Discharge: Mumbai
Incoterms: FOB
Gross Weight: 1200 kg
```

Expected:

```text
Gross Weight:
mismatch

Found:
1200 kg

Expected:
<= 1000 kg

Decision:
amendment_request
```

---

# 41. Human Review Scenario

Example:

```text
Consignee: Bata India
Gross Weight: unreadable
```

Expected:

```text
Gross Weight:
uncertain

Decision:
human_review
```

This demonstrates that the system does not guess.

---

# 42. Customer Not Found Scenario

Example:

```text
Consignee:
Unknown Trading Co.
```

Expected:

```text
Customer resolution:
not_found

Decision:
human_review
```

No customer rules should be invented.

---

# 43. Natural-Language Query Support

The database schema must support questions such as:

```text
How many shipments were auto-approved?
```

Example:

```sql
SELECT COUNT(*)
FROM pipeline_runs
WHERE final_decision = 'auto_approve';
```

---

# 44. Query: Human Review This Week

Example:

```sql
SELECT COUNT(*)
FROM pipeline_runs
WHERE final_decision = 'human_review'
  AND created_at >= datetime('now', '-7 days');
```

The SQL Agent generates the query; the SQL safety layer validates it.

---

# 45. Query: Amendment Requests

```sql
SELECT COUNT(*)
FROM pipeline_runs
WHERE final_decision = 'amendment_request';
```

---

# 46. Query: Shipments for a Customer

```sql
SELECT
    pr.id,
    d.original_filename,
    pr.final_decision,
    pr.created_at
FROM pipeline_runs pr
JOIN documents d
    ON d.id = pr.document_id
JOIN customers c
    ON c.id = pr.customer_id
WHERE c.normalized_name = 'bata india';
```

---

# 47. Query: Mismatched Fields

```sql
SELECT
    pr.id,
    vr.field_name,
    vr.found_text,
    vr.found_number,
    vr.expected_text,
    vr.expected_number,
    vr.expected_min,
    vr.expected_max,
    vr.unit,
    vr.reason
FROM validation_results vr
JOIN pipeline_runs pr
    ON pr.id = vr.run_id
WHERE vr.status = 'mismatch';
```

---

# 48. Query: Human Review Reasons

```sql
SELECT
    id,
    final_reasoning,
    created_at
FROM pipeline_runs
WHERE final_decision = 'human_review'
ORDER BY created_at DESC;
```

---

# 49. Data Integrity Rules

The application must enforce:

### Customer

```text
normalized_name must be unique
```

### Rules

```text
customer_id must reference an existing customer
operator must be supported
rule values must be valid for the operator
```

### Extraction

```text
run_id must exist
field_name must be supported
confidence must be 0..1
```

### Validation

```text
run_id must exist
status must be match/mismatch/uncertain
```

### Decision

```text
run_id must exist
decision must be one of the three supported outcomes
```

### Stage history

```text
run_id must exist
attempt >= 1
```

---

# 50. Delete Behavior

Avoid destructive cascading deletes for business/run history in the POC.

A document with a pipeline run should not be accidentally deleted just because a customer record changes.

Prefer:

```text
soft deactivation
```

for customer rules:

```text
is_active = 0
```

rather than deleting rules that may have been used historically.

Historical pipeline data should remain inspectable.

---

# 51. Rule Changes

When a customer rule changes:

```text
old rule
   ↓
deactivate
   ↓
new rule
   ↓
future runs use new rule
```

Historical runs should preserve the rule values used during their validation.

For the POC, validation-result snapshots provide this historical context.

---

# 52. Transaction Requirements

Use transactions for state changes that must remain consistent.

Example:

```text
BEGIN
    insert validation results
    update pipeline_runs.current_stage
    update pipeline_runs.status
COMMIT
```

If any operation fails:

```text
ROLLBACK
```

This prevents partial state.

---

# 53. Crash Recovery Example

Suppose the pipeline is at:

```text
current_stage = EXTRACTED
```

and:

```text
extractions
```

contains all required extracted fields.

The application crashes.

On restart:

```text
load pipeline_runs
      ↓
current_stage = EXTRACTED
      ↓
skip Extractor
      ↓
run customer resolution
```

This is the intended recovery behavior.

---

# 54. Duplicate Run Handling

A single document can technically be submitted more than once.

The system should make duplicate processing visible.

Use:

```text
content_hash
```

to detect identical uploaded files.

For the POC:

- duplicate detection may warn the user
- it should not silently merge unrelated runs
- each deliberate processing run can retain its own `run_id`

Do not introduce complex distributed idempotency infrastructure.

---

# 55. Query Source of Truth

The Query Layer must use:

```text
SQLite
```

as the source of truth for operational questions.

The LLM should never answer:

> How many shipments were processed?

from its own memory.

It should generate SQL, execute it, and explain the returned result.

---

# 56. Recommended Drizzle Structure

Conceptually:

```text
packages/database/
├── src/
│   ├── schema/
│   │   ├── customers.ts
│   │   ├── customerRules.ts
│   │   ├── documents.ts
│   │   ├── pipelineRuns.ts
│   │   ├── extractions.ts
│   │   ├── validationResults.ts
│   │   ├── decisions.ts
│   │   └── pipelineStageRuns.ts
│   │
│   ├── repositories/
│   │   ├── customerRepository.ts
│   │   ├── ruleRepository.ts
│   │   ├── runRepository.ts
│   │   ├── extractionRepository.ts
│   │   ├── validationRepository.ts
│   │   └── decisionRepository.ts
│   │
│   └── index.ts
└── drizzle/
```

The exact location can be simplified if the project remains small.

---

# 57. Seed Data

Provide a deterministic seed script.

Example:

```text
pnpm db:seed
```

It should create:

```text
Bata India
```

and its rules.

The seed should be safe to run repeatedly.

Use upsert/idempotent behavior where appropriate.

---

# 58. Migration Strategy

Use Drizzle migrations.

The repository should contain the migration files necessary to create the database.

A new developer should be able to run:

```text
pnpm db:migrate
pnpm db:seed
```

and get a usable local database.

---

# 59. POC Data Volume

The POC does not require large-scale database optimization.

Expected volume is small.

Prioritize:

```text
correctness
traceability
simplicity
queryability
```

over premature performance optimization.

---

# 60. Final Schema Summary

The core schema is:

```text
customers
──────────
id
name
normalized_name
created_at
updated_at

customer_rules
──────────────
id
customer_id
field
operator
expected_value
min_value
max_value
unit
is_active
created_at
updated_at

documents
─────────
id
original_filename
mime_type
file_size
storage_path
content_hash
created_at

pipeline_runs
─────────────
id
document_id
status
current_stage
customer_id
customer_resolution_status
customer_resolution_reason
final_decision
final_reasoning
attempt_count
error_code
error_message
created_at
updated_at
completed_at

extractions
───────────
id
run_id
field_name
value_text
value_number
unit
confidence
evidence
created_at

validation_results
──────────────────
id
run_id
field_name
status
found_text
found_number
expected_text
expected_number
expected_min
expected_max
unit
rule_id
reason
created_at

decisions
─────────
id
run_id
decision
reasoning
created_at

pipeline_stage_runs
───────────────────
id
run_id
stage
attempt
status
started_at
completed_at
error_code
error_message
metadata_json
```

---

# 61. Implementation Rules for Claude Code

Claude Code must:

1. Use this schema as the baseline.
2. Use foreign keys.
3. Add appropriate indexes.
4. Validate enums at the application layer.
5. Use migrations.
6. Provide deterministic seed data.
7. Preserve historical validation context.
8. Persist pipeline state.
9. Avoid destructive deletes for historical data.
10. Keep database access behind repositories/services where practical.
11. Use transactions for logically atomic state changes.
12. Do not introduce a second database.
13. Do not replace SQLite with a hosted database for Part 1 unless explicitly approved.
14. Update `DECISIONS.md` if the schema materially changes.
15. Add tests for database constraints and repository behavior.

---

# 62. Final Data Model Principle

The database should make one complete run reconstructable:

```text
What document?
      ↓
What did we extract?
      ↓
How confident were we?
      ↓
Which customer?
      ↓
Which rules?
      ↓
What did each rule evaluate to?
      ↓
What decision?
      ↓
Why?
      ↓
What stage was the pipeline in?
```

If a reviewer can answer all of those questions from the persisted run, the data model is serving the product correctly.
