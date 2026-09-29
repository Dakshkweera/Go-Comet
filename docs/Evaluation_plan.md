# Evaluation Plan

## 1. Purpose

This document defines how the Part 1 POC will be evaluated before submission.

The goal is not simply to prove that the happy path works. The evaluation should demonstrate that the system can:

- extract required trade-document fields,
- represent uncertainty,
- validate against customer-specific rules,
- make bounded routing decisions,
- persist state,
- recover from failures,
- answer queries from stored data,
- and produce evidence that supports the product and technical claims in the PRD.

The assignment explicitly asks for offline/online evaluation, handling of low-confidence extraction, hallucinated fields, failure/retry behavior, and state surviving a crash mid-pipeline. fileciteturn0file0L74-L85

The assignment also evaluates architecture/code, AI craft, end-to-end demo quality, PRD/Nova understanding, outcome/product thinking, and communication. fileciteturn0file0L153-L180

---

# 2. Evaluation Philosophy

The POC should be evaluated at four levels:

```text
Level 1 — Component correctness
        ↓
Level 2 — Pipeline correctness
        ↓
Level 3 — AI quality and trust
        ↓
Level 4 — Product outcome
```

A high-quality extraction alone is not sufficient.

The system should demonstrate:

```text
Document
  ↓
Correct extraction
  ↓
Known uncertainty
  ↓
Correct validation
  ↓
Safe decision
  ↓
Persisted evidence
  ↓
Useful query / UI
```

The most important evaluation principle is:

> When the system does not know, it must make that uncertainty visible rather than silently converting it into an approval.

---

# 3. Evaluation Dataset

The assignment requires at least two sample documents:

1. one clean document
2. one messy / low-quality document

fileciteturn0file0L141-L149

For a stronger evaluation, create a small labeled fixture set.

## Minimum fixture set

| Fixture | Purpose |
|---|---|
| Clean compliant document | Happy path |
| Clean document with rule mismatch | Amendment path |
| Messy / low-quality document | Uncertainty path |
| Missing required field | Missing-data path |
| Conflicting field values | Conflict path |
| Unknown customer | Customer-resolution path |
| Customer with no rules | Rule-resolution path |
| Multiple mismatches | Consolidated amendment path |
| Mismatch + uncertainty | Human-review path |
| Corrupt/unreadable document | Failure path |

The assignment does not explicitly require all of these documents; they are recommended evaluation fixtures derived from the required failure/trust questions and the intended pipeline behavior.

---

# 4. Ground Truth

Every evaluation document should have a human-labeled expected result.

For each required field, record:

```text
field
expected_value
document_evidence
is_present
is_ambiguous
```

Required extraction fields:

- consignee name
- HS code
- port of loading
- port of discharge
- Incoterms
- description of goods
- gross weight
- invoice number

These are explicitly required by the POC specification. fileciteturn0file0L103-L114

Example:

```json
{
  "field": "hs_code",
  "expected_value": "640399",
  "document_evidence": "HS CODE: 640399",
  "is_present": true,
  "is_ambiguous": false
}
```

For messy documents, ground truth should distinguish:

- actually present but difficult to read
- missing
- ambiguous
- conflicting

This distinction matters because these conditions should not all produce the same downstream behavior.

---

# 5. Extractor Evaluation

## 5.1 Field-level correctness

Measure each required field independently.

```text
correct field values
--------------------
all labeled fields
```

For the POC, report field-level accuracy rather than only whole-document accuracy.

Example:

```text
consignee_name       10/10
hs_code               9/10
port_of_loading      10/10
port_of_discharge     9/10
incoterms             10/10
description_of_goods  8/10
gross_weight           9/10
invoice_number        10/10
```

This makes weak fields visible instead of hiding them behind a single document-level score.

---

# 6. Extraction Error Categories

Every extraction error should be classified.

### Correct

The extracted value matches the labeled document value.

### Missing

The field is present in the document but the extractor returned no value.

### Incorrect

The extractor returned a value that does not match the document.

### Hallucinated

The extractor returned a value that is not supported by the document.

### Ambiguous

The document itself does not provide enough evidence to determine one reliable value.

### Conflicting

The document contains multiple contradictory values.

This classification is important because the router should treat uncertainty differently from a confident rule mismatch.

---

# 7. Evidence Evaluation

The extractor should return evidence for extracted fields where possible.

Example:

```json
{
  "value": "640399",
  "confidence": 0.91,
  "evidence": "HS CODE: 640399"
}
```

Evaluate:

1. Does evidence exist?
2. Does it actually support the value?
3. Is the evidence taken from the document?
4. Does the evidence correspond to the correct field?

A field should not be considered safely extracted merely because the LLM returned a high confidence number.

---

# 8. Confidence Evaluation

The assignment requires confidence for each extracted field but does not prescribe a mathematical confidence-calibration method. fileciteturn0file0L103-L114

Therefore, the POC should treat confidence as an uncertainty signal rather than as a mathematically calibrated probability.

Evaluate whether:

- difficult fields tend to receive lower confidence,
- clearly visible fields tend to receive higher confidence,
- unsupported values are surfaced,
- low-confidence fields reach the human-review path,
- confidence is not used by itself to approve a shipment.

## Important test

Create at least one document where:

```text
LLM confidence = high
actual value = wrong
```

The system should not blindly auto-approve based on the confidence value.

The evaluation should show that confidence is one signal within the extraction quality gate.

---

# 9. Extraction Quality Gate

Before validation, the system should evaluate whether each required field is sufficiently reliable.

Example:

```text
Field present?
    ↓
Evidence present?
    ↓
Confidence acceptable?
    ↓
Value format valid?
    ↓
Any conflicting values?
    ↓
Reliable enough for validation
```

If the quality gate fails:

```text
extraction
    ↓
uncertain
    ↓
human review
```

This is preferable to allowing unreliable values to become deterministic mismatches.

---

# 10. Validator Evaluation

The Validator takes extracted JSON plus a customer-specific rule set and returns per-field:

- match
- mismatch
- uncertain

The assignment explicitly requires these outcomes and requires mismatches to show found vs expected values. fileciteturn0file0L114-L121

## Test categories

### Exact match

```text
Expected: FOB
Found:    FOB
Result:   MATCH
```

### Exact mismatch

```text
Expected: FOB
Found:    CIF
Result:   MISMATCH
```

### Range match

```text
Expected: <= 1200 kg
Found:    1100 kg
Result:   MATCH
```

### Range mismatch

```text
Expected: <= 1200 kg
Found:    1400 kg
Result:   MISMATCH
```

### Uncertain

```text
Expected: 640399
Found:    null
Reason:   extraction uncertain
Result:   UNCERTAIN
```

---

# 11. Validator Ground-Truth Matrix

Create a deterministic unit-test matrix.

| Rule | Found | Expected | Result |
|---|---|---|---|
| EXACT | FOB | FOB | MATCH |
| EXACT | CIF | FOB | MISMATCH |
| MAX | 1000 | <=1200 | MATCH |
| MAX | 1400 | <=1200 | MISMATCH |
| MIN | 1000 | >=800 | MATCH |
| MIN | 700 | >=800 | MISMATCH |
| RANGE | 1000 | 800–1200 | MATCH |
| RANGE | 1400 | 800–1200 | MISMATCH |
| Any | null | known | UNCERTAIN |

The exact supported operators should match the contracts in `AGENT_CONTRACTS.md` and schema in `DATA_MODEL.md`.

---

# 12. Router Evaluation

The Router is evaluated on decision correctness.

The POC has three required decision categories:

- auto-approve
- human review
- amendment request

fileciteturn0file0L121-L126

## Decision matrix

| Condition | Expected decision |
|---|---|
| All required fields reliable + all validations match | AUTO_APPROVE |
| Known reliable mismatch | AMENDMENT_REQUEST |
| Missing required field | HUMAN_REVIEW |
| Low-confidence required field | HUMAN_REVIEW |
| Conflicting extraction | HUMAN_REVIEW |
| Unknown customer | HUMAN_REVIEW |
| Customer has no rules | HUMAN_REVIEW |
| Mismatch + uncertainty | HUMAN_REVIEW |
| Extraction/API failure after bounded retries | HUMAN_REVIEW |
| Invalid/ambiguous rule | HUMAN_REVIEW |

The Router should also provide reasoning, as required by the assignment. fileciteturn0file0L121-L126

---

# 13. Critical Trust Tests

These are the tests that should be emphasized in the demo and technical write-up.

## Test A — Hallucinated field

Input:

```text
Field is not visible in the document.
```

Expected:

```text
No invented value
→ uncertain/missing
→ human review
```

## Test B — Low-confidence extraction

Expected:

```text
low confidence
→ uncertainty preserved
→ no silent approval
→ human review
```

## Test C — Known mismatch

Expected:

```text
reliable value
→ validation mismatch
→ amendment request
→ found vs expected shown
```

## Test D — Mixed mismatch and uncertainty

Expected:

```text
mismatch + uncertainty
→ human review
```

The system must not send an amendment request when it does not have enough evidence to know what is wrong.

---

# 14. Customer Resolution Evaluation

Because rules are customer-specific, customer resolution is part of the trust boundary.

Test:

### Known customer

```text
Document
→ consignee identified
→ customer found
→ rules loaded
```

### Unknown customer

```text
Document
→ no reliable customer match
→ HUMAN_REVIEW
```

### Ambiguous customer

```text
Document
→ multiple possible customers
→ HUMAN_REVIEW
```

### Customer exists but rules missing

```text
Customer found
→ no rules
→ HUMAN_REVIEW
```

The system must not invent customer-specific rules.

---

# 15. Crash-Recovery Evaluation

The assignment explicitly asks how state survives a crash mid-pipeline. fileciteturn0file0L81-L85

Test by intentionally interrupting the pipeline after:

1. document ingestion
2. extraction
3. customer resolution
4. validation
5. decision
6. persistence

After restart, verify that persisted state identifies:

- pipeline run
- completed stages
- current stage
- previous outputs
- errors
- retry attempt

The expected behavior is:

```text
Crash
  ↓
Restart
  ↓
Read persisted state
  ↓
Resume/recover safely
  ↓
Do not blindly repeat completed work
```

The exact resume strategy should follow the implementation documented in `ARCHITECTURE.md` and `TECHNICAL_DESIGN.md`.

---

# 16. Retry and Runaway-Cost Evaluation

The assignment explicitly asks how the system avoids loops and runaway costs. fileciteturn0file0L81-L85

Test:

```text
LLM timeout
LLM malformed response
LLM repeated invalid output
```

Expected:

- bounded retry count
- exponential/backoff strategy where implemented
- no infinite retry loop
- failed stage persisted
- controlled fallback to human review where appropriate

Example:

```text
Attempt 1 → failure
Attempt 2 → failure
Attempt 3 → failure
→ stop
→ persist failure
→ HUMAN_REVIEW
```

Do not retry deterministic validation failures as if they were temporary model failures.

---

# 17. Duplicate Processing Evaluation

Submit the same document twice.

Evaluate whether the system:

- detects duplicate processing where the design supports it,
- avoids accidental duplicate state,
- maintains idempotent stage behavior,
- does not create contradictory decisions.

The exact duplicate policy should be documented before implementation.

---

# 18. Query Layer Evaluation

The Query Layer should be evaluated independently.

## Test set

### Correct database queries

```text
Which shipments were auto-approved?
```

```text
Which documents had uncertain extraction?
```

```text
Show shipments for Bata India.
```

### Empty result

```text
Which shipments have HS code 999999?
```

Expected:

```text
No matching records found.
```

### Ambiguous query

```text
Show me the bad shipments.
```

Expected:

```text
Clarification or explicitly defined interpretation.
```

### Unsafe query

Attempt to cause:

```sql
DELETE FROM ...
```

Expected:

```text
Rejected.
```

### Prompt-injection-like query

Expected:

```text
No database write access.
No instruction override.
```

---

# 19. End-to-End Evaluation

The most important POC evaluation is an actual full run.

For each representative document:

```text
Upload
  ↓
Extract
  ↓
Resolve customer
  ↓
Load rules
  ↓
Validate
  ↓
Route
  ↓
Persist
  ↓
Display in UI
  ↓
Query stored result
```

Verify that the UI shows:

- extracted fields
- confidence
- validation result
- decision
- reasoning

These are explicitly required in the minimal UI specification. fileciteturn0file0L126-L130

---

# 20. Demo Evaluation Script

The demo should use at least two real documents because the assignment requires one clean and one messy/low-quality sample. fileciteturn0file0L141-L149

## Demo 1 — Clean compliant document

Show:

```text
Document
→ high-quality extraction
→ validation matches
→ AUTO_APPROVE
→ persisted result
```

## Demo 2 — Messy document

Show:

```text
Messy scan
→ uncertain extraction
→ uncertainty surfaced
→ HUMAN_REVIEW
```

## Demo 3 — Known mismatch

If time permits:

```text
Reliable extraction
→ rule mismatch
→ AMENDMENT_REQUEST
→ found vs expected
```

## Demo 4 — Query

Ask:

```text
Which shipments require human review?
```

Show that the answer comes from persisted database state.

The assignment asks for a 2–3 minute demo video showing the POC in action. fileciteturn0file0L141-L149

---

# 21. Metrics

The evaluation should report a small number of meaningful metrics rather than a large dashboard.

## Extraction

- field-level accuracy
- unsupported/hallucinated field rate
- missing-field rate
- evidence-support rate
- confidence behavior on difficult fields

## Validation

- validation correctness
- mismatch detection rate
- uncertain-case detection rate

## Routing

- correct routing rate
- unsafe auto-approval count
- incorrect amendment count
- human-review capture for uncertain cases

## Reliability

- retry count
- pipeline failure rate
- recovery success rate
- duplicate-processing behavior

## Query Layer

- SQL intent correctness
- SQL safety rejection rate
- answer faithfulness
- query latency

---

# 22. Primary Safety Metric

A particularly important metric is:

## Unsafe auto-approval rate

```text
documents incorrectly auto-approved
------------------------------------
all documents
```

Target for the POC:

```text
0 known unsafe auto-approvals
```

This should be treated as a safety criterion, not as a claim that the system is universally error-free.

If a document is uncertain, the system should prefer human review rather than silently approving it.

---

# 23. Model Comparison

The assignment asks for model choices and reasoning, including the vision-capable model and fallback behavior. fileciteturn0file0L87-L102

Do not choose a model only from benchmark reputation.

For candidate models, evaluate the same labeled documents.

Suggested dimensions:

| Dimension | Measurement |
|---|---|
| Extraction accuracy | Field-level correctness |
| Structured output | Valid JSON / schema pass rate |
| Messy-document performance | Accuracy on low-quality docs |
| Confidence behavior | Uncertainty separation |
| Evidence quality | Evidence supports value |
| Latency | End-to-end model latency |
| Cost | Approximate cost per document |
| Failure behavior | Timeouts/errors/malformed output |

The final model choice should be based on observed project results and documented constraints.

---

# 24. Offline vs Online Evaluation

## Offline evaluation

Use fixed labeled documents and expected outputs.

Purpose:

- compare models
- regression-test prompts
- evaluate extraction
- evaluate validator/router logic
- reproduce failures

Offline evaluation should be deterministic wherever possible.

## Online evaluation

During actual POC runs, capture:

- processing latency
- model failures
- retry frequency
- human-review frequency
- decision distribution
- query usage
- unexpected failure cases

The assignment asks how the system would be evaluated offline/online, so both should be described in the technical write-up. fileciteturn0file0L81-L85

---

# 25. Regression Suite

Every change to:

- extraction prompt
- model
- extraction schema
- confidence logic
- validation logic
- routing logic
- customer-resolution logic

should run the regression fixture set.

At minimum:

```text
clean compliant
clean mismatch
messy
missing field
conflicting value
unknown customer
no customer rules
mixed mismatch + uncertainty
```

A change should not be considered complete if it improves one fixture while silently breaking another.

---

# 26. Test Pyramid

Use a practical test pyramid.

```text
             E2E
            /   \
        Integration
        /         \
      Unit       Model Eval
```

## Unit tests

Deterministic:

- rule operators
- normalization
- confidence gates
- router
- SQL validator
- schemas

## Integration tests

- extractor → customer resolver
- resolver → validator
- validator → router
- persistence
- query layer

## End-to-end tests

- document → final decision
- document → persisted state → query

## Model evaluation

- labeled documents
- extraction quality
- confidence/evidence behavior
- model comparison

---

# 27. Failure Log

Maintain a small evaluation log:

```text
case_id
document
expected_behavior
actual_behavior
failure_category
severity
root_cause
fix
regression_test
```

Example:

```text
case_id: messy-003
expected: HUMAN_REVIEW
actual: AUTO_APPROVE
failure: low-confidence field accepted
severity: critical
root_cause: quality gate bypassed
fix: require evidence + confidence threshold
regression_test: test_messy_low_confidence_routes_to_review
```

This makes the evaluation useful for engineering rather than merely presentation.

---

# 28. Evaluation Report

Before submission, summarize:

## Dataset

- number of documents
- clean vs messy
- number of labeled fields
- customer/rule scenarios

## Extraction

- field accuracy
- hallucination/unsupported-value findings
- confidence/evidence findings

## Validation

- match/mismatch/uncertain correctness

## Routing

- decision correctness
- unsafe auto-approval findings

## Reliability

- retry behavior
- crash recovery
- duplicate handling

## Query Layer

- representative query accuracy
- SQL safety
- answer faithfulness

## Model selection

- candidates tested
- observed trade-offs
- selected model and rationale

## Known limitations

Explicitly list what the POC does not yet prove.

---

# 29. Known Limitations

The evaluation must not overclaim.

The POC does not by itself establish:

- production-scale throughput
- universal document-format coverage
- statistically calibrated confidence
- zero hallucinations across unseen documents
- production security certification
- enterprise-grade multi-tenant isolation
- real customer workflow integration
- broad generalization beyond the evaluated document set

These are future validation areas.

Part 2 of the assignment introduces a more realistic CG workflow with simulated inbox behavior, multiple attachments, cross-document consistency, and draft replies; those requirements should not be incorrectly represented as completed by the Part 1 evaluation. fileciteturn0file0L236-L304

---

# 30. Definition of Done

The evaluation plan is complete when:

- [ ] At least one clean document is labeled.
- [ ] At least one messy/low-quality document is labeled.
- [ ] Required extraction fields have ground truth.
- [ ] Extractor field-level evaluation exists.
- [ ] Evidence is evaluated.
- [ ] Confidence behavior is tested.
- [ ] Hallucination/unsupported-value behavior is tested.
- [ ] Validator has deterministic unit tests.
- [ ] Router has a decision matrix and tests.
- [ ] Unknown customer behavior is tested.
- [ ] Missing rules behavior is tested.
- [ ] Mixed mismatch + uncertainty behavior is tested.
- [ ] Crash recovery is tested.
- [ ] Retry bounds are tested.
- [ ] Query Layer has safety tests.
- [ ] End-to-end runs are demonstrated.
- [ ] Metrics are recorded.
- [ ] Known limitations are documented.
- [ ] Results can be summarized in the technical write-up and demo.

---

# 31. Claude Code Execution Order

Claude Code should implement evaluation alongside the system rather than waiting until the end.

Recommended sequence:

```text
Phase 1
  Build fixtures + ground truth
        ↓
Phase 2
  Build deterministic validator tests
        ↓
Phase 3
  Build router decision tests
        ↓
Phase 4
  Build extractor integration
        ↓
Phase 5
  Run model/prompt evaluation
        ↓
Phase 6
  Build persistence + crash tests
        ↓
Phase 7
  Build Query Layer tests
        ↓
Phase 8
  Run end-to-end evaluation
        ↓
Phase 9
  Record metrics + known failures
        ↓
Phase 10
  Freeze demo + submission evidence
```

The evaluation suite is part of the product, not an optional final step.
