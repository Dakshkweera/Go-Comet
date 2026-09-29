# Agent Contracts
## GoComet Nova — Part 1: Multi-Agent Trade Document Pipeline

**Status:** Implementation-ready  
**Audience:** Claude Code / engineering implementation  
**Scope:** Part 1 only  
**Related documents:** `PRD.md`, `ARCHITECTURE.md`, `TECHNICAL_DESIGN.md`, `DATA_MODEL.md`, `DECISIONS.md`

---

# 1. Purpose

This document defines the typed contracts between the components of the Part 1 system.

The goal is to prevent agents/services from communicating through ambiguous free-form text.

The main handoff chain is:

```text
Document
   ↓
Extractor
   ↓
ExtractionResult
   ↓
Customer Resolver
   ↓
CustomerResolution
   ↓
Rule Loader
   ↓
CustomerRules
   ↓
Validator
   ↓
ValidationResult[]
   ↓
Router
   ↓
RouterDecision
```

The Query Layer has a separate contract:

```text
User Question
   ↓
Query Router
   ↓
QueryClassification
   ↓
SQL Agent
   ↓
SQLGenerationResult
   ↓
SQL Validator
   ↓
SQLite
   ↓
Answer Generator
```

All contracts should be represented using **TypeScript types/interfaces plus Zod schemas**.

---

# 2. Contract Principles

## 2.1 Structured communication

Internal components exchange structured objects.

Do not rely on:

```text
"Looks good, approve this."
```

Use:

```json
{
  "decision": "auto_approve",
  "reasoning": "All required customer rules matched."
}
```

---

## 2.2 Validate every external/model boundary

Anything coming from:

- LLMs
- HTTP requests
- uploaded files
- database query generation

must be validated before being trusted.

---

## 2.3 Nullable means unknown/missing

For extraction:

```json
{
  "value": null
}
```

means no reliable value was extracted.

Do not use invented placeholders such as:

```text
"N/A"
"unknown"
"not found"
```

unless those are literally present in the document and are the intended extracted value.

---

# 3. Shared Primitive Types

## 3.1 Confidence

```ts
import { z } from "zod";

export const confidenceSchema = z
  .number()
  .min(0)
  .max(1);

export type Confidence = z.infer<typeof confidenceSchema>;
```

Meaning:

```text
0.0 = no confidence
1.0 = maximum model-reported confidence
```

This is an uncertainty signal, not automatically a calibrated probability.

---

# 4. Supported Extraction Fields

Use a fixed list for the Part 1 POC:

```ts
export const extractionFieldSchema = z.enum([
  "consignee_name",
  "hs_code",
  "port_of_loading",
  "port_of_discharge",
  "incoterms",
  "description_of_goods",
  "gross_weight",
  "invoice_number",
]);

export type ExtractionField =
  z.infer<typeof extractionFieldSchema>;
```

Do not silently add additional required fields without updating the product/design documents.

---

# 5. Extracted Text Field

For ordinary text fields:

```ts
export const extractedTextFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: confidenceSchema,
  evidence: z.string().nullable().optional(),
});

export type ExtractedTextField =
  z.infer<typeof extractedTextFieldSchema>;
```

Examples:

```json
{
  "value": "Bata India",
  "confidence": 0.96,
  "evidence": "CONSIGNEE: Bata India"
}
```

Missing:

```json
{
  "value": null,
  "confidence": 0.12,
  "evidence": null
}
```

---

# 6. Extracted Numeric Field

For numeric values:

```ts
export const extractedNumberFieldSchema = z.object({
  value: z.number().nullable(),
  confidence: confidenceSchema,
  unit: z.string().nullable().optional(),
  evidence: z.string().nullable().optional(),
});

export type ExtractedNumberField =
  z.infer<typeof extractedNumberFieldSchema>;
```

Example:

```json
{
  "value": 1200,
  "confidence": 0.94,
  "unit": "kg",
  "evidence": "GROSS WEIGHT: 1200 KG"
}
```

---

# 7. Extraction Result

The complete Extractor output:

```ts
export const extractionResultSchema = z.object({
  consignee_name: extractedTextFieldSchema,

  hs_code: extractedTextFieldSchema,

  port_of_loading: extractedTextFieldSchema,

  port_of_discharge: extractedTextFieldSchema,

  incoterms: extractedTextFieldSchema,

  description_of_goods: extractedTextFieldSchema,

  gross_weight: extractedNumberFieldSchema,

  invoice_number: extractedTextFieldSchema,
});

export type ExtractionResult =
  z.infer<typeof extractionResultSchema>;
```

This is the primary contract between:

```text
Extractor → Customer Resolver / Validator
```

---

# 8. Extractor Input

The Extractor receives a normalized document reference.

```ts
export const extractionInputSchema = z.object({
  runId: z.string().min(1),
  documentId: z.string().min(1),
  filePath: z.string().min(1),
  mimeType: z.string().min(1),
});

export type ExtractionInput =
  z.infer<typeof extractionInputSchema>;
```

The Extractor should not receive customer rules.

Its responsibility is document understanding, not validation.

---

# 9. Extractor Interface

```ts
export interface ExtractorAgent {
  extract(
    input: ExtractionInput
  ): Promise<ExtractionResult>;
}
```

Implementation responsibilities:

1. Read the document.
2. Send it to the vision-capable LLM.
3. Request structured output.
4. Validate the model response with Zod.
5. Perform quality checks.
6. Return `ExtractionResult`.
7. Throw a structured application error if extraction cannot safely complete.

---

# 10. Extraction Quality Contract

The Extractor must not return malformed data.

Before returning:

```text
LLM response
   ↓
Zod
   ↓
quality checks
   ↓
ExtractionResult
```

Quality checks include:

```text
confidence in [0,1]
numeric values are numeric
required objects exist
field names are known
```

The Extractor must not silently coerce clearly invalid model output into valid-looking business data.

---

# 11. Customer Resolution Input

The Customer Resolver receives the extracted customer identity.

```ts
export const customerResolutionInputSchema = z.object({
  runId: z.string().min(1),
  consigneeName: z.string().nullable(),
});

export type CustomerResolutionInput =
  z.infer<typeof customerResolutionInputSchema>;
```

If:

```text
consigneeName = null
```

the resolver cannot reliably resolve a customer.

The pipeline should proceed to human review rather than guessing.

---

# 12. Customer Resolution Status

```ts
export const customerResolutionStatusSchema = z.enum([
  "resolved",
  "not_found",
  "ambiguous",
]);

export type CustomerResolutionStatus =
  z.infer<typeof customerResolutionStatusSchema>;
```

---

# 13. Customer Resolution Result

```ts
export const customerResolutionSchema = z.object({
  status: customerResolutionStatusSchema,

  customerId: z.string().nullable(),

  customerName: z.string().nullable(),

  reason: z.string().min(1),
});

export type CustomerResolution =
  z.infer<typeof customerResolutionSchema>;
```

Examples.

### Resolved

```json
{
  "status": "resolved",
  "customerId": "cust_bata_india",
  "customerName": "Bata India",
  "reason": "Unique customer match."
}
```

### Not found

```json
{
  "status": "not_found",
  "customerId": null,
  "customerName": null,
  "reason": "No configured customer matched the extracted consignee."
}
```

### Ambiguous

```json
{
  "status": "ambiguous",
  "customerId": null,
  "customerName": null,
  "reason": "Multiple customers matched the normalized consignee name."
}
```

---

# 14. Customer Resolver Interface

```ts
export interface CustomerResolver {
  resolve(
    input: CustomerResolutionInput
  ): Promise<CustomerResolution>;
}
```

The resolver must not:

- invent customers
- invent rules
- make validation decisions

---

# 15. Rule Operator

```ts
export const ruleOperatorSchema = z.enum([
  "EXACT",
  "MIN",
  "MAX",
  "RANGE",
]);

export type RuleOperator =
  z.infer<typeof ruleOperatorSchema>;
```

---

# 16. Customer Rule

```ts
export const customerRuleSchema = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  field: extractionFieldSchema,
  operator: ruleOperatorSchema,

  expectedValue: z.union([
    z.string(),
    z.number(),
  ]).nullable(),

  minValue: z.number().nullable(),
  maxValue: z.number().nullable(),

  unit: z.string().nullable(),

  isActive: z.boolean(),
});

export type CustomerRule =
  z.infer<typeof customerRuleSchema>;
```

---

# 17. Rule Set

```ts
export const customerRuleSetSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  rules: z.array(customerRuleSchema),
});

export type CustomerRuleSet =
  z.infer<typeof customerRuleSetSchema>;
```

---

# 18. Rule Loading Contract

Input:

```ts
export const ruleLoadInputSchema = z.object({
  customerId: z.string().min(1),
});

export type RuleLoadInput =
  z.infer<typeof ruleLoadInputSchema>;
```

Output:

```text
CustomerRuleSet
```

Interface:

```ts
export interface RuleService {
  getRules(
    input: RuleLoadInput
  ): Promise<CustomerRuleSet>;
}
```

If no rules exist, the service should return an empty rule set or a structured not-configured state according to the repository implementation.

The Router must not treat an empty rule set as automatic approval.

---

# 19. Validator Input

```ts
export const validationInputSchema = z.object({
  runId: z.string().min(1),
  extraction: extractionResultSchema,
  customer: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
  }),
  rules: z.array(customerRuleSchema),
});

export type ValidationInput =
  z.infer<typeof validationInputSchema>;
```

---

# 20. Validation Status

```ts
export const validationStatusSchema = z.enum([
  "match",
  "mismatch",
  "uncertain",
]);

export type ValidationStatus =
  z.infer<typeof validationStatusSchema>;
```

Do not add `missing` as a validation status.

Missing extraction should be represented in the extraction contract and result in uncertainty/safe escalation where appropriate.

---

# 21. Validation Result

```ts
export const validationResultSchema = z.object({
  field: extractionFieldSchema,

  status: validationStatusSchema,

  foundText: z.string().nullable(),
  foundNumber: z.number().nullable(),

  expectedText: z.string().nullable(),
  expectedNumber: z.number().nullable(),

  expectedMin: z.number().nullable(),
  expectedMax: z.number().nullable(),

  unit: z.string().nullable(),

  ruleId: z.string().nullable(),

  reason: z.string().min(1),
});

export type ValidationResult =
  z.infer<typeof validationResultSchema>;
```

---

# 22. Validation Result Semantics

## MATCH

Example:

```json
{
  "field": "incoterms",
  "status": "match",
  "foundText": "FOB",
  "expectedText": "FOB",
  "reason": "Extracted Incoterms exactly matches the customer rule."
}
```

## MISMATCH

Example:

```json
{
  "field": "gross_weight",
  "status": "mismatch",
  "foundNumber": 1200,
  "expectedMax": 1000,
  "unit": "kg",
  "reason": "Gross weight exceeds the customer's maximum."
}
```

## UNCERTAIN

Example:

```json
{
  "field": "gross_weight",
  "status": "uncertain",
  "foundNumber": null,
  "expectedMax": 1000,
  "unit": "kg",
  "reason": "Gross weight could not be reliably extracted."
}
```

---

# 23. Validator Interface

```ts
export interface Validator {
  validate(
    input: ValidationInput
  ): Promise<ValidationResult[]>;
}
```

The Validator should be deterministic.

It should not call an LLM for:

```text
EXACT
MIN
MAX
RANGE
```

comparisons.

---

# 24. Validation Rules

## EXACT

```text
normalized extracted value
        =
normalized expected value
```

## MIN

```text
extracted >= expected minimum
```

## MAX

```text
extracted <= expected maximum
```

## RANGE

```text
minimum <= extracted <= maximum
```

If a comparison cannot be performed safely:

```text
UNCERTAIN
```

---

# 25. Router Input

```ts
export const routerInputSchema = z.object({
  runId: z.string().min(1),

  customerResolution:
    customerResolutionSchema,

  rulesAvailable: z.boolean(),

  extraction:
    extractionResultSchema,

  validations:
    z.array(validationResultSchema),

  pipelineErrors:
    z.array(z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })).optional(),
});

export type RouterInput =
  z.infer<typeof routerInputSchema>;
```

---

# 26. Router Decision

```ts
export const decisionSchema = z.enum([
  "auto_approve",
  "human_review",
  "amendment_request",
]);

export type Decision =
  z.infer<typeof decisionSchema>;
```

---

# 27. Router Decision Result

```ts
export const routerDecisionSchema = z.object({
  decision: decisionSchema,

  reasoning: z.string().min(1),
});

export type RouterDecision =
  z.infer<typeof routerDecisionSchema>;
```

---

# 28. Router Interface

```ts
export interface Router {
  decide(
    input: RouterInput
  ): RouterDecision;
}
```

The Router should be deterministic and side-effect free.

It should not modify the database itself.

Persistence belongs to the orchestrator/repository layer.

---

# 29. Router Rules

The Router should evaluate in a safe order.

## Rule 1 — Customer not resolved

```text
not_found
or
ambiguous
```

→

```text
human_review
```

---

## Rule 2 — Rules unavailable

```text
rulesAvailable = false
```

→

```text
human_review
```

---

## Rule 3 — Critical extraction uncertainty

If a required field cannot be reliably established:

→

```text
human_review
```

---

## Rule 4 — Validation uncertainty

If unresolved validation results contain:

```text
uncertain
```

→

```text
human_review
```

---

## Rule 5 — Known mismatch

If there are one or more confident mismatches and no unresolved critical uncertainty:

→

```text
amendment_request
```

---

## Rule 6 — All required rules match

If:

```text
customer resolved
AND
rules available
AND
no unresolved uncertainty
AND
all required validations = match
```

→

```text
auto_approve
```

---

# 30. Mixed Mismatch + Uncertainty

This is an important contract rule.

Example:

```text
HS code → mismatch
Gross weight → uncertain
```

Do not produce:

```text
amendment_request
```

because the system does not have enough reliable information to produce a complete amendment decision.

Result:

```text
human_review
```

---

# 31. Decision Reasoning

Reasoning should be generated from structured facts.

Examples:

### Auto approve

```text
Customer was resolved as Bata India.
All configured required rules matched.
No unresolved extraction or validation uncertainty remains.
```

### Amendment

```text
Customer was resolved as Bata India.
Gross weight mismatched the customer rule:
found 1200 kg, expected <= 1000 kg.
No unresolved uncertainty remains.
```

### Human review

```text
Customer was resolved as Bata India, but gross weight could not be reliably extracted.
Automatic compliance could not be established.
```

The Router should not invent factual details.

---

# 32. Pipeline State Contract

```ts
export const pipelineStageSchema = z.enum([
  "RECEIVED",
  "EXTRACTING",
  "EXTRACTED",
  "CUSTOMER_RESOLVING",
  "CUSTOMER_RESOLVED",
  "VALIDATING",
  "VALIDATED",
  "ROUTING",
  "ROUTED",
  "COMPLETED",
]);

export type PipelineStage =
  z.infer<typeof pipelineStageSchema>;
```

---

# 33. Pipeline Run Status

```ts
export const pipelineStatusSchema = z.enum([
  "RECEIVED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
]);

export type PipelineStatus =
  z.infer<typeof pipelineStatusSchema>;
```

These are separate concepts:

```text
status = overall run state

currentStage = where processing is/was occurring
```

---

# 34. Pipeline Error Contract

```ts
export const pipelineErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  stage: pipelineStageSchema.optional(),
  retryable: z.boolean(),
  attempt: z.number().int().positive().optional(),
});

export type PipelineError =
  z.infer<typeof pipelineErrorSchema>;
```

Example:

```json
{
  "code": "MODEL_TIMEOUT",
  "message": "Vision model request timed out.",
  "stage": "EXTRACTING",
  "retryable": true,
  "attempt": 1
}
```

---

# 35. Pipeline Result

```ts
export const pipelineResultSchema = z.object({
  runId: z.string().min(1),
  status: pipelineStatusSchema,
  currentStage: pipelineStageSchema,

  extraction: extractionResultSchema.nullable(),

  customerResolution:
    customerResolutionSchema.nullable(),

  validations:
    z.array(validationResultSchema),

  decision:
    routerDecisionSchema.nullable(),

  error:
    pipelineErrorSchema.nullable(),
});

export type PipelineResult =
  z.infer<typeof pipelineResultSchema>;
```

This is useful for API responses and integration tests.

---

# 36. Query Contracts

The Query Layer is separate from the trade-document agents.

---

# 37. Query Classification

```ts
export const queryTypeSchema = z.enum([
  "general_question",
  "database_query",
]);

export type QueryType =
  z.infer<typeof queryTypeSchema>;
```

Result:

```ts
export const queryClassificationSchema = z.object({
  type: queryTypeSchema,
});

export type QueryClassification =
  z.infer<typeof queryClassificationSchema>;
```

---

# 38. Query Router Interface

```ts
export interface QueryRouter {
  classify(
    question: string
  ): Promise<QueryClassification>;
}
```

Examples:

```text
"What is an Incoterm?"
→ general_question

"How many shipments were auto-approved this week?"
→ database_query
```

---

# 39. SQL Generation Result

```ts
export const sqlGenerationResultSchema = z.object({
  sql: z.string().min(1),
});

export type SqlGenerationResult =
  z.infer<typeof sqlGenerationResultSchema>;
```

---

# 40. SQL Agent Interface

```ts
export interface SqlAgent {
  generate(
    question: string,
    schemaDescription: string
  ): Promise<SqlGenerationResult>;
}
```

The SQL Agent only generates SQL.

It must not execute SQL.

---

# 41. SQL Validation Result

```ts
export const sqlValidationResultSchema = z.object({
  valid: z.boolean(),
  reason: z.string().min(1),
});

export type SqlValidationResult =
  z.infer<typeof sqlValidationResultSchema>;
```

Example:

```json
{
  "valid": true,
  "reason": "Read-only SELECT query using allowed tables."
}
```

Rejected:

```json
{
  "valid": false,
  "reason": "UPDATE statements are not permitted."
}
```

---

# 42. SQL Validator Interface

```ts
export interface SqlValidator {
  validate(
    sql: string
  ): SqlValidationResult;
}
```

The validator must reject:

```text
INSERT
UPDATE
DELETE
DROP
ALTER
CREATE
```

and other write/destructive operations.

---

# 43. Query Execution Result

The SQL executor should return structured data.

Conceptual:

```ts
export const queryExecutionResultSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.unknown())),
});

export type QueryExecutionResult =
  z.infer<typeof queryExecutionResultSchema>;
```

The exact database-driver representation can be adapted during implementation.

---

# 44. Answer Generation Input

```ts
export const answerInputSchema = z.object({
  question: z.string().min(1),
  sql: z.string().min(1),
  result: queryExecutionResultSchema,
});

export type AnswerInput =
  z.infer<typeof answerInputSchema>;
```

---

# 45. Answer Generator Interface

```ts
export interface AnswerGenerator {
  generate(
    input: AnswerInput
  ): Promise<string>;
}
```

The Answer Generator must only explain the supplied database result.

It must not invent additional database facts.

---

# 46. General Question Contract

For:

```text
general_question
```

the Query Layer may use a general LLM response.

The response should remain within the application's known product/system context.

It does not need to query SQLite.

---

# 47. Database Question Contract

For:

```text
database_query
```

the flow is:

```text
Question
   ↓
SQL Agent
   ↓
SQLGenerationResult
   ↓
SQL Validator
   ↓
SQLite
   ↓
QueryExecutionResult
   ↓
Answer Generator
   ↓
Natural-language answer
```

---

# 48. API Query Response

Conceptual:

```ts
export const queryResponseSchema = z.object({
  type: queryTypeSchema,
  answer: z.string().min(1),

  data: queryExecutionResultSchema.nullable(),

  sql: z.string().nullable(),
});

export type QueryResponse =
  z.infer<typeof queryResponseSchema>;
```

In production, SQL may be hidden from ordinary users while remaining available in development/debug mode.

---

# 49. Contract Ownership

Each contract has a clear owner.

```text
ExtractionResult
    → Extractor

CustomerResolution
    → Customer Resolver

CustomerRuleSet
    → Rule Service

ValidationResult
    → Validator

RouterDecision
    → Router

PipelineResult
    → Orchestrator

QueryClassification
    → Query Router

SqlGenerationResult
    → SQL Agent

SqlValidationResult
    → SQL Validator

QueryExecutionResult
    → Database layer

Answer
    → Answer Generator
```

No component should modify another component's output in an undocumented way.

---

# 50. Contract Flow

Complete trade pipeline:

```text
ExtractionInput
       ↓
Extractor
       ↓
ExtractionResult
       ↓
CustomerResolutionInput
       ↓
CustomerResolver
       ↓
CustomerResolution
       ↓
RuleLoadInput
       ↓
RuleService
       ↓
CustomerRuleSet
       ↓
ValidationInput
       ↓
Validator
       ↓
ValidationResult[]
       ↓
RouterInput
       ↓
Router
       ↓
RouterDecision
```

---

# 51. Query Flow

```text
Question
   ↓
QueryRouter
   ↓
QueryClassification
   │
   ├─────────────── general_question
   │                     ↓
   │                    LLM
   │
   └─────────────── database_query
                         ↓
                      SqlAgent
                         ↓
                  SqlGenerationResult
                         ↓
                    SqlValidator
                         ↓
                    SQLite
                         ↓
                QueryExecutionResult
                         ↓
                  AnswerGenerator
                         ↓
                    final answer
```

---

# 52. Contract Testing

Every schema should have tests.

For each contract:

```text
valid object → accepted
invalid object → rejected
missing required property → rejected
wrong type → rejected
invalid enum → rejected
```

Particularly test:

### Extraction

```text
confidence < 0 → reject
confidence > 1 → reject
invalid numeric value → reject
```

### Validation

```text
invalid status → reject
```

### Decision

```text
unknown decision → reject
```

### SQL

```text
empty SQL → reject
```

---

# 53. Golden Examples

Store representative JSON fixtures.

Suggested structure:

```text
packages/contracts/
├── src/
│   ├── extraction.ts
│   ├── customer.ts
│   ├── rules.ts
│   ├── validation.ts
│   ├── decision.ts
│   ├── pipeline.ts
│   └── query.ts
│
└── fixtures/
    ├── extraction-clean.json
    ├── extraction-uncertain.json
    ├── validation-match.json
    ├── validation-mismatch.json
    ├── validation-uncertain.json
    ├── decision-auto.json
    ├── decision-human.json
    └── decision-amendment.json
```

Fixtures should be used in tests and examples.

---

# 54. What Claude Code Must Not Do

Claude Code must not:

- pass free-form agent text between stages
- let the Extractor decide validation
- let the Validator decide the final operational outcome
- let the Router re-extract fields
- invent customer rules
- silently convert uncertainty into mismatch
- silently convert missing fields into matches
- execute raw SQL from the SQL Agent
- bypass Zod validation
- add arbitrary fields to required contracts without updating documentation
- add a fourth core trade-document agent without justification

---

# 55. Contract Evolution

When a contract changes:

1. update the Zod schema
2. update TypeScript type
3. update fixture examples
4. update unit tests
5. update affected implementation
6. update documentation
7. record significant architectural changes in `DECISIONS.md`

Do not make hidden contract changes inside individual agents.

---

# 56. Final Contract Principle

The system should behave like a typed pipeline:

```text
Unstructured document
       ↓
Typed extraction
       ↓
Typed customer resolution
       ↓
Typed rules
       ↓
Typed validation
       ↓
Typed decision
       ↓
Typed persisted state
```

This creates clear boundaries between AI-generated information and deterministic business logic.

The LLM can be probabilistic.

The **handoff between components must not be ambiguous**.
