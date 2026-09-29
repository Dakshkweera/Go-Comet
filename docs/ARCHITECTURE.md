# Architecture Design
## GoComet Nova — Part 1: Multi-Agent Trade Document Pipeline

**Status:** Implementation-ready  
**Scope:** Part 1 only  
**Source of truth:** `PRD.md` + `DECISIONS.md`

---

# 1. Architecture Objective

The architecture must demonstrate a reliable, traceable trade-document workflow:

```text
Trade Document
      ↓
Vision-based Extraction
      ↓
Customer Resolution
      ↓
Customer Rule Loading
      ↓
Deterministic Validation
      ↓
Decision / Routing
      ↓
Persisted Operational Outcome
```

The architecture deliberately separates:

- document understanding
- customer/rule resolution
- validation
- operational decision

This makes failures observable and allows each stage to be evaluated independently.

---

# 2. System Context

```text
                         ┌─────────────────────┐
                         │       React UI      │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │  Node.js / Fastify  │
                         │        API          │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Pipeline Orchestrator│
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
        ┌───────────┐       ┌──────────────┐       ┌───────────┐
        │ Extractor │       │   Validator  │       │  Router   │
        │ Vision LLM│       │ Deterministic│       │Deterministic│
        └─────┬─────┘       └──────┬───────┘       └─────┬─────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    ▼
                            ┌──────────────┐
                            │    SQLite    │
                            └──────┬───────┘
                                   │
                         ┌─────────┴─────────┐
                         ▼                   ▼
                    Query Layer          Run / UI
```

---

# 3. Technology Architecture

## Frontend

```text
React
Vite
TypeScript
```

Responsibilities:

- document upload
- pipeline execution trigger
- run status
- extraction display
- confidence display
- validation display
- decision display
- reasoning display
- natural-language query interface

The frontend should not contain business rules.

---

## Backend

```text
Node.js
TypeScript
Fastify
```

Responsibilities:

- API endpoints
- pipeline orchestration
- file handling
- agent/service invocation
- database operations
- query layer
- error handling
- logging

---

## Data / Persistence

```text
SQLite
Drizzle
```

SQLite is intentionally selected for the POC because it is:

- local
- persistent
- queryable
- easy to run
- sufficient for the expected workload

The database is also used to persist pipeline state so completed work survives process failure.

---

## Schema / Contract Validation

```text
Zod
```

Zod is used at system boundaries to validate:

- LLM structured output
- API input
- agent handoffs
- customer rules
- validation results
- router decisions
- query-agent output

---

## Model Gateway

```text
OpenRouter
```

OpenRouter is treated as the model gateway rather than embedding a provider-specific implementation throughout the application.

Model IDs should be configurable through environment variables.

Example:

```env
EXTRACTOR_MODEL=...
QUERY_ROUTER_MODEL=...
SQL_MODEL=...
ANSWER_MODEL=...
```

---

# 4. Core Pipeline

The main pipeline is:

```text
POST /runs
     ↓
Create pipeline run
     ↓
Persist RECEIVED
     ↓
Extractor
     ↓
Persist EXTRACTION
     ↓
Customer Resolver
     ↓
Persist CUSTOMER_RESOLVED
     ↓
Load Customer Rules
     ↓
Validator
     ↓
Persist VALIDATION
     ↓
Router
     ↓
Persist DECISION
     ↓
COMPLETED
```

Each important stage persists its result before the pipeline advances.

---

# 5. Pipeline State Machine

The pipeline should use explicit states.

```text
RECEIVED
    ↓
EXTRACTING
    ↓
EXTRACTED
    ↓
CUSTOMER_RESOLVING
    ↓
CUSTOMER_RESOLVED
    ↓
VALIDATING
    ↓
VALIDATED
    ↓
ROUTING
    ↓
ROUTED
    ↓
COMPLETED
```

Failure state:

```text
FAILED
```

A failed stage should contain enough metadata to understand:

- where it failed
- why it failed
- whether it is retryable
- how many attempts occurred

---

# 6. Crash Recovery

The architecture is designed to resume from persisted state.

Example:

```text
RECEIVED
   ↓
EXTRACTED
   ↓
Application crashes
```

After restart:

```text
Read pipeline state
      ↓
EXTRACTED
      ↓
Skip extraction
      ↓
Resume customer resolution
```

This avoids repeating an expensive vision-model call unnecessarily.

The orchestrator should determine the next incomplete stage from persisted state.

---

# 7. Extractor Architecture

## Responsibility

The Extractor answers:

> What does the document say?

It is the only core component whose primary responsibility requires visual document understanding.

```text
PDF / Image
     ↓
Document normalization
     ↓
Vision-capable LLM
     ↓
Structured output
     ↓
Zod validation
     ↓
ExtractionResult
```

---

## ExtractionResult

Conceptual structure:

```ts
type ExtractedField<T = string> = {
  value: T | null;
  confidence: number;
  evidence?: string;
};

type ExtractionResult = {
  consignee_name: ExtractedField;
  hs_code: ExtractedField;
  port_of_loading: ExtractedField;
  port_of_discharge: ExtractedField;
  incoterms: ExtractedField;
  description_of_goods: ExtractedField;
  gross_weight: ExtractedField<number> & {
    unit?: string;
  };
  invoice_number: ExtractedField;
};
```

The exact implementation must use Zod schemas.

---

# 8. Model Strategy

The initial vision-model candidate is:

```text
Gemini 2.5 Pro
```

through OpenRouter.

This is a candidate rather than an unconditional assumption that it is universally best.

The project should evaluate candidate models using representative project documents.

Evaluation dimensions:

```text
Field accuracy
Structured output reliability
Confidence behavior
Messy-document performance
Latency
Approximate cost
Failure behavior
```

The final selection should be documented in the model evaluation report.

---

# 9. Extraction Quality Gate

After the model returns structured output:

```text
LLM output
   ↓
Zod schema validation
   ↓
Quality checks
```

Quality checks should identify:

- missing required values
- invalid field formats
- impossible numeric values
- missing confidence
- invalid confidence range
- conflicting extraction where detectable
- malformed structured output

If the result is not safe to use, the pipeline should not silently continue.

It should either:

```text
controlled retry
       ↓
quality check
       ↓
continue
```

or:

```text
Human Review
```

---

# 10. Customer Resolution

Customer resolution is a distinct stage between extraction and validation.

```text
ExtractionResult
      ↓
consignee_name
      ↓
Customer lookup
      ↓
Customer found?
```

Cases:

### Customer found

Load that customer's configured rules.

### Customer not found

Do not guess.

Route to human review.

### Ambiguous customer match

Do not arbitrarily select one.

Route to human review.

### Customer found but no rules

Do not invent rules.

Route to human review.

---

# 11. Rule Resolution

Rules belong to the customer.

Conceptually:

```text
Customer
   │
   ├── HS code rule
   ├── Port loading rule
   ├── Port discharge rule
   ├── Incoterms rule
   └── Gross weight rule
```

Example:

```json
{
  "customer": "Bata India",
  "rules": [
    {
      "field": "hs_code",
      "operator": "EXACT",
      "expected": "640399"
    },
    {
      "field": "port_of_loading",
      "operator": "EXACT",
      "expected": "Shanghai"
    },
    {
      "field": "port_of_discharge",
      "operator": "EXACT",
      "expected": "Mumbai"
    },
    {
      "field": "incoterms",
      "operator": "EXACT",
      "expected": "FOB"
    },
    {
      "field": "gross_weight",
      "operator": "MAX",
      "expected": 1000,
      "unit": "kg"
    }
  ]
}
```

---

# 12. Validator Architecture

The Validator should primarily be deterministic code.

```text
ExtractionResult
       +
CustomerRules
       ↓
Normalization
       ↓
Rule evaluation
       ↓
ValidationResult[]
```

The Validator should not use an LLM for simple comparisons.

---

# 13. Rule Operators

Initial operators:

```text
EXACT
MIN
MAX
RANGE
```

Examples:

```text
EXACT:
incoterms = FOB

MAX:
gross_weight <= 1000 kg

MIN:
gross_weight >= 100 kg

RANGE:
gross_weight between 500 and 1000 kg
```

The implementation can add more operators only when required by the POC.

---

# 14. Validation Result

Each field produces:

```ts
type ValidationStatus =
  | "match"
  | "mismatch"
  | "uncertain";

type ValidationResult = {
  field: string;
  status: ValidationStatus;
  found?: string | number;
  expected?: string | number;
  reason: string;
};
```

---

# 15. Validation Semantics

## MATCH

The extracted value reliably satisfies the configured rule.

## MISMATCH

The extracted value is sufficiently reliable and violates the configured rule.

Example:

```text
Field: gross_weight

Status: mismatch

Found: 1200 kg
Expected: <= 1000 kg
```

## UNCERTAIN

The system cannot reliably determine whether the rule is satisfied.

Examples:

- low-confidence extraction
- unreadable field
- conflicting values
- ambiguous comparison
- unsupported rule

---

# 16. Missing vs Uncertain vs Mismatch

These states must remain distinct.

```text
Missing
  ↓
No reliable extracted value exists

Uncertain
  ↓
Value may exist but cannot be trusted enough

Mismatch
  ↓
Reliable value exists and violates the rule
```

A missing field should not be artificially represented as a mismatch.

---

# 17. Router Architecture

The Router receives:

```text
Customer resolution
Customer rules
Extraction state
Validation results
Pipeline errors
```

and produces:

```ts
type Decision =
  | "auto_approve"
  | "human_review"
  | "amendment_request";
```

with:

```ts
type RouterDecision = {
  decision: Decision;
  reasoning: string;
};
```

---

# 18. Router Decision Matrix

## AUTO_APPROVE

Conditions:

```text
customer resolved
AND
rules available
AND
required fields reliable
AND
no unresolved uncertainty
AND
all required validations match
```

## AMENDMENT_REQUEST

Conditions:

```text
one or more confident mismatches
AND
no unresolved critical uncertainty
```

The amendment should explain:

```text
what was found
what was expected
what needs correction
```

## HUMAN_REVIEW

Examples:

```text
customer not found
ambiguous customer
rules unavailable
missing critical field
low confidence
conflicting values
unsupported rule
extraction failure after bounded retry
mixed mismatch + uncertainty
```

---

# 19. Core Routing Principle

```text
Known compliant
      ↓
AUTO_APPROVE

Known violation
      ↓
AMENDMENT_REQUEST

Insufficient reliable information
      ↓
HUMAN_REVIEW
```

This logic should be deterministic and testable.

---

# 20. Persistence Architecture

The database should preserve both business data and pipeline state.

Conceptual entities:

```text
documents
customers
customer_rules
pipeline_runs
extractions
validation_results
decisions
```

Relationships:

```text
Customer
   │
   └── CustomerRules

Document
   │
   └── PipelineRun
          │
          ├── Extractions
          ├── ValidationResults
          └── Decision
```

---

# 21. Data Ownership

Each stage owns a specific type of information.

```text
Extractor
  → extracted document facts

Customer Resolver
  → selected customer

Rule Loader
  → customer rules used

Validator
  → rule evaluation

Router
  → operational decision

SQLite
  → durable system state
```

This makes debugging easier.

---

# 22. Query Layer Architecture

The Query Layer is separate from the trade-document processing agents.

```text
User
 ↓
Query Router
 ↓
 ┌─────────────────────┐
 │                     │
 ↓                     ↓
General             Database
Question            Question
 │                     │
 ↓                     ↓
LLM                 SQL Agent
                       ↓
                   SQL Validator
                       ↓
                     SQLite
                       ↓
                 Answer Generator
```

---

# 23. Query Router

The Query Router classifies the question:

```json
{
  "type": "general_question"
}
```

or:

```json
{
  "type": "database_query"
}
```

The distinction is whether the question requires stored operational data.

Examples:

```text
"What is an Incoterm?"
→ general_question

"How many shipments were auto-approved this week?"
→ database_query
```

---

# 24. SQL Agent

The SQL Agent receives:

- user question
- allowed database schema

and generates SQL.

Example:

```sql
SELECT COUNT(*)
FROM pipeline_runs
WHERE final_decision = 'human_review'
  AND created_at >= date('now', '-7 days');
```

---

# 25. SQL Safety Layer

Never execute raw LLM-generated SQL directly.

Flow:

```text
LLM-generated SQL
       ↓
SQL Validator
       ↓
SELECT only?
       ↓
Schema valid?
       ↓
Execute
```

Reject:

```text
DELETE
UPDATE
INSERT
DROP
ALTER
```

The query layer is read-only.

---

# 26. Answer Generation

The Answer Generator receives:

```text
Original question
Generated SQL
Database result
```

It converts the result into natural language.

The database remains the source of truth.

The LLM must not invent values that are absent from the database result.

---

# 27. API Architecture

Conceptual API surface:

```text
POST /api/runs
```

Create/process a document run.

```text
GET /api/runs/:id
```

Retrieve the full run.

```text
GET /api/runs/:id/extraction
```

Retrieve extraction.

```text
GET /api/runs/:id/validation
```

Retrieve validation.

```text
GET /api/runs/:id/decision
```

Retrieve final decision.

```text
POST /api/query
```

Ask a natural-language question.

```text
GET /api/customers/:id
```

Retrieve customer/rules.

Exact route naming can be adjusted during implementation.

---

# 28. Frontend Architecture

```text
React
 ├── UploadPage
 ├── RunPage
 │    ├── DocumentPanel
 │    ├── ExtractionPanel
 │    ├── CustomerPanel
 │    ├── ValidationPanel
 │    └── DecisionPanel
 │
 └── QueryPage
      ├── QuestionInput
      ├── QueryStatus
      └── AnswerPanel
```

The frontend should consume API responses and should not duplicate backend decision logic.

---

# 29. Run Page

The primary demo page should show:

```text
Document
     ↓
Extraction
     ↓
Customer
     ↓
Rules
     ↓
Validation
     ↓
Decision
```

For each field:

```text
Name
Value
Confidence
Evidence
Validation
```

For mismatches:

```text
Found
Expected
Reason
```

For final decision:

```text
Decision
Reasoning
```

---

# 30. Error Boundary

Errors should be surfaced as structured application states rather than raw stack traces.

Example:

```json
{
  "status": "failed",
  "stage": "extraction",
  "error_code": "MODEL_TIMEOUT",
  "retryable": true,
  "attempt": 1
}
```

The UI should show a useful operational message.

---

# 31. Retry Architecture

Retry behavior should be centralized.

Each retryable operation should have:

```text
maximum attempts
retryable errors
attempt count
backoff
final failure state
```

Example:

```text
Attempt 1
   ↓
timeout
   ↓
Attempt 2
   ↓
timeout
   ↓
HUMAN_REVIEW / FAILED
```

No unbounded recursion.

---

# 32. Idempotency / Duplicate Processing

The system should avoid accidentally processing the same document repeatedly.

For the POC, a document fingerprint/hash can be used where practical.

At minimum, the run model should make duplicate runs identifiable.

The implementation should not silently merge unrelated documents.

---

# 33. Security Architecture

Treat all uploaded documents as untrusted data.

Security boundaries:

```text
Document content
      ↓
LLM input only
```

Document content must not modify:

- system instructions
- customer rules
- routing logic
- SQL permissions

The SQL agent cannot write to the database.

The frontend cannot directly access SQLite.

---

# 34. Observability

Every run gets:

```text
run_id
```

Every stage should record:

```text
run_id
stage
status
attempt
started_at
completed_at
error
```

LLM metadata should include, where available:

```text
model
latency
attempt
success/failure
```

Avoid unnecessarily logging full sensitive documents.

---

# 35. Testing Architecture

Tests should exist at several levels.

## Unit tests

Test:

- rule evaluation
- normalization
- router logic
- SQL validation
- state transitions

## Integration tests

Test:

```text
document
 → extractor mock
 → customer resolver
 → validator
 → router
 → SQLite
```

## Model evaluation

Test actual candidate models against representative documents.

## UI / API verification

Verify that a complete run can be displayed.

---

# 36. Model Evaluation Architecture

Create an isolated evaluation harness.

```text
Sample Documents
      ↓
Evaluation Runner
      ↓
┌──────────┬──────────┬──────────┐
│ Model A  │ Model B  │ Model C  │
└────┬─────┴────┬─────┴────┬─────┘
     ↓          ↓          ↓
Field Results
     ↓
Evaluation Report
```

Store:

```text
model
document
field
expected
actual
correct
confidence
latency
error
```

The final model choice should be based on this evidence.

---

# 37. Deployment / Runtime Model

For the POC:

```text
Developer machine
      ↓
Node.js backend
      ↓
SQLite file
      ↓
React frontend
      ↓
OpenRouter API
```

No cloud infrastructure is required for the initial POC.

The architecture can later be migrated to managed database/storage services, but that is outside the Part 1 requirement.

---

# 38. Repository Architecture

Recommended structure:

```text
project/
│
├── apps/
│   ├── api/
│   └── web/
│
├── packages/
│   ├── contracts/
│   ├── database/
│   └── shared/
│
├── evaluation/
│
├── samples/
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── AGENT_CONTRACTS.md
│   ├── QUERY_LAYER_DESIGN.md
│   ├── EVALUATION_PLAN.md
│   └── IMPLEMENTATION_PLAN.md
│
├── DECISIONS.md
├── CLAUDE.md
├── README.md
├── package.json
└── pnpm-workspace.yaml
```

The exact monorepo layout may be simplified if it creates unnecessary complexity for the POC.

---

# 39. Architectural Non-Goals

Do not introduce:

- microservices
- message queues
- Kubernetes
- distributed workflow infrastructure
- complex event buses
- multiple databases
- vector databases
- unnecessary agent frameworks

unless a concrete POC requirement demonstrates that they are needed.

The system should remain understandable and runnable locally.

---

# 40. Why This Architecture Fits the POC

The architecture balances AI capability with deterministic software.

```text
Vision / language problem
        ↓
       LLM

Business-rule problem
        ↓
   Deterministic code

State problem
        ↓
     SQLite

User interaction
        ↓
      React
```

This avoids using an LLM for tasks that code can perform more reliably.

It also gives a reviewer a clear path from:

```text
input
 ↓
extraction
 ↓
rules
 ↓
validation
 ↓
decision
 ↓
stored evidence
```

---

# 41. End-to-End Example

A document contains:

```text
Consignee: Bata India
HS Code: 640399
Port of Loading: Shanghai
Port of Discharge: Mumbai
Incoterms: FOB
Gross Weight: 1200 KG
Invoice: INV-2026-1042
```

Customer rules include:

```text
HS Code = 640399
Port Loading = Shanghai
Port Discharge = Mumbai
Incoterms = FOB
Gross Weight <= 1000 KG
```

Pipeline:

```text
PDF
 ↓
Extractor
 ↓
Structured extraction
 ↓
Customer = Bata India
 ↓
Load Bata India rules
 ↓
Validator
 ↓
HS Code        MATCH
Port Loading   MATCH
Port Discharge MATCH
Incoterms      MATCH
Gross Weight   MISMATCH
 ↓
Router
 ↓
AMENDMENT_REQUEST
```

Reason:

```text
Gross weight is 1200 KG.
Customer rule requires <= 1000 KG.
```

The UI displays the same evidence.

The database persists the complete run.

A query can then ask:

```text
How many shipments required amendment requests?
```

and retrieve the answer from SQLite.

---

# 42. Architectural Decision Summary

Current baseline:

```text
Runtime:
Node.js

Language:
TypeScript

Backend:
Fastify

Frontend:
React + Vite

Database:
SQLite

DB layer:
Drizzle

Schema validation:
Zod

Model gateway:
OpenRouter

Initial vision model:
Gemini 2.5 Pro

Core agents:
Extractor
Validator
Router

Query Layer:
Query Router
SQL Agent
Answer Generator

Deterministic components:
Validator
Router
SQL safety
State machine

Persistence:
SQLite

Recovery:
Persist stage outputs and resume from last completed stage
```

Any significant architectural change should be recorded in `DECISIONS.md`.

---

# 43. Implementation Rule

Claude Code should implement this architecture incrementally.

It must not:

- invent new agents without justification
- replace deterministic logic with unnecessary LLM calls
- skip schema validation
- execute raw LLM SQL
- remove persistence
- remove failure handling
- silently alter the three-outcome router
- implement Part 2
- over-engineer the POC

If a design decision is genuinely unclear, Claude should stop and surface the ambiguity rather than silently inventing a product requirement.
