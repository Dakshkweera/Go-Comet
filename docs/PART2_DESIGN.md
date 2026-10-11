# Part 2 — Backend Design: Simulated SU Inbox → Shipment Verification → CG Reply

Status: backend implemented on branch `part2/inbox-shipments` and verified on live Gemini; decision record DECISIONS ID-11. Scope: backend, architecture, flow and the API
contract. The frontend is built separately against §11. The repository is authoritative
where this document and the code differ; Part 1 behaviour and endpoints stay unchanged.

---

## 1. Scope

**Must (graded in Part 2):**
- Trigger: an SU email (`.eml`) dropped into a watched inbox folder starts processing on its own.
- One email = one shipment cycle; every attachment is processed separately with the Part 1
  Extractor.
- Content-based document classification (`BOL`, `COMMERCIAL_INVOICE`, `PACKING_LIST`,
  `CERTIFICATE_OF_ORIGIN`, `OTHER`). The filename is never used.
- A two-stage check: intake first, then validation (owner checks, customer rules,
  consistency across documents).
- One review screen per stage. CG review items and amendment items are shown together, and a
  stage produces at most one email.
- Deterministic, editable reply drafts. The server blocks Send until review is done; sending
  is simulated; there is a Sent Emails list.
- SU corrections start a new cycle on the same shipment, checked from stage 1 again.
- Idempotency on the email Message-ID and on the full-file SHA-256.
- The query layer answers "show me everything pending review for customer X".
- An audit trail (event timeline) per shipment.

**Should (if time allows; the schema supports it from day one):** CG can correct a
document's type, `GET /api/metrics`, a second seeded customer.

**Won't:** real SMTP/IMAP, LLM-written drafts, configurable ownership UI, rule editor,
auth or roles, forwarding to the customer, combined "invoice cum packing list" documents.

---

## 2. End-to-end flow

```
SU email (.eml) ─► data/inbox/ ─(watcher, every 2 s)─► Ingest (idempotent)
                       new thread → new shipment (cycle 1) · reply in thread → same shipment, cycle n+1
                                                        ▼
            EXTRACTOR (LLM, Part 1)  each attachment: 8 fields + confidence + evidence
                                     + "what document is this?" (same call)
            CLASSIFIER (code)        model answer checked against the PDF title → type or OTHER
                                                        ▼  all attachments done
            STAGE 1: INTAKE          files open? types clear? required documents present?
                                     required fields readable? customer known?
                                                        │
                       CG review screen: review items + amendment items together
                       review → "clarify" (closed)  or  "amend" (joins the amendment list)
                                                        │
                       amendments? ── yes ─► ONE amendment email (CG sends) ─► cycle closed
                                     └─ no ──┐
                                             ▼
            STAGE 2: VALIDATION      owner checks, customer rules, consistency across files
                                                        │
                       same CG review screen, same rules
                                                        │
                       amendments? ── yes ─► ONE amendment email (CG sends) ─► cycle closed
                                     └─ no ──► approval draft ─► CG sends ─► shipment done

SU sends corrections in the thread ─► new cycle ─► stage 1 again, on the latest version of each document
```

Nothing is ever sent without a CG click. Every step writes a `shipment_events` row (progress
view, audit trail, trace from Message-ID to the sent reply).

**Why validation waits for a clean intake:** validating an incomplete or unreadable set gives
SU fixes based on partial data. Stage 2 always runs on a complete, readable set. The cost is
that a stage 2 problem reaches SU one cycle later when stage 1 also needed an amendment. This
is a deliberate choice (DECISIONS ID-11).

---

## 3. Agent boundaries (unchanged from Part 1, wider input)

| Step | Part 1 | Part 2 addition | LLM? |
|---|---|---|---|
| Extractor | 8 fields + confidence + evidence | also answers "what document is this?" | yes, one call per attachment |
| Classifier | – | checks that answer against the PDF title | no |
| Validator | rules on one document | stage 1 intake checks + stage 2 owner, rule and consistency checks | no |
| Router | decision for one document | per-stage decision + reply draft | no |

The Extractor only reads. Every decision is made by deterministic code, so a misread can't
approve itself. The inbox, ingestion, persistence and sending are plumbing, not agents.

Code layout (the ESLint layer rules already cover `validation/` and `routing/`):

```
services/inbox/         eml.ts (parse, filter, sniff MIME), ingest.service.ts, watcher.ts
services/extraction/    classify.ts (pure)   prompt also asks for document_type
services/validation/    intake.ts (stage 1, pure)   crossDocument.ts (stage 2, pure)
                        documentRules.ts (ownership, required fields, compare keys)
services/routing/       shipmentRouter.ts (pure)    replyDraft.ts (pure templates)
services/shipment/      shipment.service.ts (orchestration, persistence, resume)
                        review.service.ts, outbound.service.ts, shipment.view.ts
controllers/ routes/    inbox, shipments, sent-emails, metrics
```

---

## 4. Trigger, ingestion and idempotency

**Format:** real RFC 822 `.eml` files, parsed with `mailparser`. This mocks the plumbing
while keeping real email semantics: Message-ID, In-Reply-To, References, Reply-To, MIME
attachments.

**Entry points.** All three call one `ingestEmail(raw)`.
1. Watcher: polls `INBOX_DIR` every `INBOX_POLL_MS`. It ingests each `*.eml`, then moves it to
   `processed/` (or `failed/` if it can't be parsed, which is logged). Polling is used because
   `fs.watch` is unreliable on Windows.
2. `POST /api/inbox/samples/:name/deliver` copies a sample into `INBOX_DIR`, so the demo
   button uses the real trigger.
3. `POST /api/inbox/emails` (multipart `.eml`) ingests directly.

**Idempotency:**

| What | Key | Result |
|---|---|---|
| Same email again | `Message-ID` (or SHA-256 of the raw email if there's no Message-ID) | ignored, `duplicate: true` |
| Same file twice in one email | email ID + SHA-256 of the **entire file** | stored once |
| A new reply contains a file identical to one already received for this shipment | SHA-256 of the entire file | processed as part of the new cycle, flagged **"unchanged from cycle n"**; its extraction is reused (no LLM call); the draft says the requested correction was not made |

The filename is never part of any identity. A byte hash only catches exact copies: a
re-exported PDF gets a new hash and is extracted again, and validation still catches an
uncorrected value.

**Thread linking** (no match → new shipment; never linked by guessing, e.g. never by invoice
number):
1. `In-Reply-To` / `References` contain the Message-ID of a stored inbound or sent email.
2. Otherwise, the subject tag `[SHP-0001]` that our replies add, as a fallback for mail
   clients that break threading. It is accepted only when the sender matches an earlier
   sender on that shipment, because a subject line is easy to forge.

A reply after `APPROVAL_SENT` reopens the shipment as a new cycle.

**Attachments:**
- Keep parts with `Content-Disposition: attachment`, plus non-inline PDFs. Skip inline
  signature images (they have a `cid`), recording them as a `skipped` event.
- Detect the real type from magic bytes (`%PDF`, PNG, JPEG, WEBP). Mail clients often send
  `application/octet-stream`.
- Unsupported or oversized files are stored as failed documents. They are never dropped
  silently.
- Store the raw `.eml` under `EMAIL_DIR` as audit evidence. Store attachments under
  `UPLOAD_DIR` with generated names, so SU filenames never reach the LLM or the filesystem.

The email body is **never** sent to an LLM. It is shown to CG as plain text only.

---

## 5. Per-attachment processing and classification

- An attachment is an ordinary Part 1 `documents` + `pipeline_runs` pair with `shipment_id`
  set. The pipeline runs only the extraction stage for these runs: retries, stage history,
  timeouts and crash resume are reused unchanged. Standalone Part 1 uploads
  (`shipment_id IS NULL`) behave exactly as today.
- A failed extraction (after bounded retries, or a corrupt PDF) leaves the run `COMPLETED`
  with `error_code`. The shipment treats it as a failed file.
- A shared limiter (`EXTRACTION_CONCURRENCY`, default 2) wraps the extractor, so parallel
  shipments can't trip OpenRouter's 429 limit.
- `GET /api/runs` lists standalone runs only. `DELETE /api/runs/:id` returns
  `409 RUN_PART_OF_SHIPMENT` for attachment runs.

**Classification is based on content, never on the filename or the 8 fields.** The model
sees the whole page and answers "what document is this?" using type-specific markers:
- BOL: B/L number, vessel/voyage, containers, shipper, notify party.
- Invoice: unit price, totals, payment terms.
- Packing list: cartons/packages, weight per package.
- Certificate of origin: origin country, issuing authority, a stamp.

`classifyDocument()` then checks that answer against the PDF title (first ~15 lines of the
text layer). "Proforma invoice" never counts as an invoice.

| PDF title | Model answer | Result |
|---|---|---|
| type T | T, or no answer | **T** |
| type T | U ≠ T, confident (≥ 0.8) | **OTHER** (they disagree) |
| none (scan) | U, confident | **U** |
| unclear, several types, or no confident answer | – | **OTHER** |

A confident classification never needs review. `OTHER` matters only in the cases listed in §6.

---

## 6. The two stages

### 6.1 Document rules (constants in `documentRules.ts`)

The owner is a document **type**, not a PDF. R = must appear on that type; · = checked if
present. A field missing from a type where it isn't required is normal (e.g. a BOL without an
invoice number).

| Field | Owner | Invoice | BOL | Packing list | CoO | Cross-document check |
|---|---|---|---|---|---|---|
| invoice_number | Invoice | R | · | · | · | yes |
| consignee_name | – | R | R | · | · | yes |
| hs_code | – | R | · | · | · | yes |
| port_of_loading | BOL | · | R | · | · | yes |
| port_of_discharge | BOL | · | R | · | · | yes |
| incoterms | Invoice | R | · | · | · | yes |
| gross_weight | Packing list | · | R | R | · | yes (tolerance) |
| description_of_goods | Invoice | R | · | · | · | **no**: other documents may describe goods in general terms (UCP 600 art. 14(e)) |

**Required documents** (default; a per-customer setting is the next step): invoice, BOL,
packing list. A certificate of origin is checked if it is present.

**Comparison keys** (safe normalisation only):

| Field | Key |
|---|---|
| consignee_name | Part 1 `normalizeCustomerName` (case, punctuation, legal suffixes) |
| hs_code | digits only. Equal if identical, or if one is a prefix of the other and the shorter has ≥ 6 digits |
| ports | first comma part, case and whitespace collapsed |
| incoterms | 3-letter code |
| invoice_number | uppercase letters and digits only |
| gross_weight | kg via Part 1 `toKg`; equal if the difference ≤ max(1 kg, 0.1 %) |

### 6.2 Stage 1: intake (`intake.ts`, pure)

Inputs: the current documents (the latest version of each type plus all `OTHER` files),
their extractions, the customer resolution, and the rules.

| Check (`kind`) | Severity | CG choices / draft wording |
|---|---|---|
| A file failed: corrupt, unsupported, too large, extraction failed (`attachment_failed`) | **amendment** | "We could not open scan_01.pdf. Please resend it." CG can waive it with a note. |
| A required document is missing, with no `OTHER` or failed file in the set (`missing_document`) | **amendment** | "We did not receive a packing list. Please send it." |
| A required document is missing, and the set has a failed file (`missing_document`) | **amendment** | "If scan_01.pdf was the packing list, resending it is enough; otherwise please send the packing list." |
| A required document is missing, and the set has an `OTHER` file (`missing_document`) | **review** | CG opens the file: set the type (re-checks), clarify ("proceed without it", note required; the field is then treated as unowned), or amend |
| No documents at all (`no_attachments`) | **amendment** | "The email had no documents attached." |
| A required field is empty on a typed document (`missing_field`) | **review** | The extractor may have missed it. CG checks the original: clarify **with the value**, or amend ("the BOL does not show the port of discharge") |
| A value is unreliable: low confidence, ambiguous, contradicted, invalid format; Part 1 `assessField` on non-null values (`unreliable_value`) | **review** | clarify (the value is optional and defaults to the extracted one), or amend ("please send a clearer copy") |
| Two documents of the same type disagree (`duplicate_type_conflict`) | **review** | could be a corrected copy, a duplicate or a split shipment: clarify **with the value**, or amend |
| Customer unknown or ambiguous (`customer_unresolved`) | **review** | amend only ("please confirm the consignee") |
| No rules configured for the customer (`no_rules`) | **review** | clarify with a note: stage 2 then checks consistency only, and approval is allowed as a recorded CG decision |

`OTHER` files are not checked in stage 1. The customer is resolved from the consignees of the
typed documents, with clarified values applied. If they point to different customers, the
customer is ambiguous.

**A clarified value** becomes that document's verified reading (confidence 1, evidence
"verified by CG"). Stage 2 then applies the normal owner and rule logic to it. The original
extraction is never changed.

When there are no stage 1 amendments and every review item is clarified, stage 2 runs
immediately. It is pure, takes milliseconds and sends no email.

### 6.3 Stage 2: validation (`crossDocument.ts`, pure)

This runs only on a clean intake, so every value it uses is present and reliable, or was
verified by CG.

For each field, in this order:
1. **Rule check on every typed document** carrying the field (the Part 1 validator,
   unchanged). A violation is an **amendment** on that document (`rule_mismatch`): "HS code
   shows 6403.22; Bata India requires 6403.99." Documents showing the same wrong value share
   one item. If the validator can't decide (unknown unit, broken rule), it becomes a
   **review** item (`cannot_verify`).
2. **Pick the reference:**
   - Owned field whose owner passes the rule (or has no rule) → the owner's value.
   - Owner fails the rule → the rule's expected value for EXACT rules, otherwise no
     reference.
   - Unowned field, or owner document missing → the rule's expected value (EXACT),
     otherwise no reference.
3. **Consistency on typed documents** that have no rule violation for this field:
   - With a reference: each document that differs is an **amendment** on that document
     (`document_mismatch`): "Gross weight shows 950 kg; the packing list shows 900 kg.
     Please make the bill of lading match the packing list."
   - Without a reference: if the documents disagree, one **amendment** (`inconsistent`)
     lists every document and value: "please confirm the correct value and correct the
     documents". The agent never picks a winner.
   - Values that can't be compared (unknown weight unit) → `cannot_verify` (review).
4. **`OTHER` files:** their reliable values are compared with the reference or with the
   typed documents. A disagreement is a **review** item (`other_document_mismatch`),
   because we don't know what the file is. CG either clarifies with a note ("not part of
   this shipment" / "it's fine") or amends.

In stage 2, **clarify** always means "accept as is" and needs a note. Values are only
verified in stage 1.

**Approval** needs no issues left in stage 2, ≥ 1 active rule, and every rule matched. This
is the Part 1 condition applied to the whole set.

Example (port of discharge, owner BOL, rule Mumbai):

| BOL | Invoice | Result |
|---|---|---|
| Mumbai | Mumbai | ok |
| Mumbai | Chennai | amend the invoice (breaks the rule; the BOL already shows Mumbai) |
| Chennai | Mumbai | amend the BOL (breaks the rule); the invoice is fine |
| Chennai | Chennai | amend both, in one item (both break the rule) |

With a rule on the field, a wrong document is reported as a rule violation. `document_mismatch`
("make the BOL match the packing list") applies when a field has no exact rule, for example a
weight within the MAX limit that differs from the packing list, or an invoice number. Expected
HS codes are shown as printed on documents (`6403.99`), not as stored in the rule.

### 6.4 Issue model

Each issue has:
- `stage` (`intake|validation`), `severity` (`review|amendment`), `kind`, `field`, and the
  affected document(s);
- `found`, and `expected` (only from a rule or a reference, never invented), plus
  `reference`;
- `message`: why it was flagged, written for CG;
- `request`: the sentence used in the reply to SU;
- `allowedActions`.

The issue key is deterministic, `kind:field:docId+docId`, and stable across re-evaluations,
so CG actions attach to it.

Field state, used for the colour in the grid:
- `ok`: everything passed.
- `amendment`: has an amendment issue.
- `review`: has an open review issue.

Each field also carries `ruleStatus` (`match|mismatch|uncertain|no_rule`) and `consistency`
(`consistent|inconsistent|single_source|not_checked`).

---

## 7. CG review screen, drafts and the send gate

**One screen per stage.** Review items and amendment items are shown together.

| CG action | Applies to | Effect |
|---|---|---|
| `clarify` | review items; amendment items (to waive them) | closes the item. A **value is required** for `missing_field` and `duplicate_type_conflict`, and optional for `unreliable_value` (defaults to the extracted value). Every other clarify (waiving, accepting, proceeding without rules) **needs a note**. |
| `amend` | review items | the item joins the stage's amendment list, phrased as a request to SU |
| `set type` | any file | sets the document type (logged as a review action) and re-runs the checks |

Actions are append-only (`review_actions`); the latest action on an item wins, and the
original extraction is never changed. Actions apply to one cycle only: a new SU cycle is
checked from scratch.

**The draft** always reflects the current state:
- the stage's amendment items plus the review items CG marked `amend`;
- once nothing needs amending after stage 2, an approval draft;
- `null` while only review items are open and nothing needs amending yet.

It is regenerated after every action that changes the outcome. Each regeneration gets a new
`version`; saving edits does **not** change the version. Older versions are kept as
`superseded`, and the view flags `previousVersionEdited`.

**The send gate is enforced by the server.** `POST …/draft/send` succeeds only when:
- no review items are open (`409 REVIEW_INCOMPLETE`);
- the client's `version` is the current one (`409 DRAFT_OUTDATED`, e.g. SU replied
  meanwhile);
- the draft has not been sent already (`409 ALREADY_SENT`).

Sending an amendment closes the cycle (`AMENDMENT_SENT`). Sending an approval closes the
shipment (`APPROVAL_SENT`).

**Draft content** (deterministic templates, no LLM, so values are exact and nothing is
invented):
- **To:** SU's `Reply-To`, otherwise `From`.
- **Subject:** `Re: <original> [SHP-0001]`, with `In-Reply-To` set, so the reply lands in
  SU's own thread.
- **Grouped by document,** because SU reissues documents. Each item names the field, the
  file, the found value and the expected value.

```
Subject: Re: Shipment documents INV-2026-2042 [SHP-0002]

Hello Guangzhou Leatherworks team,

Thank you for the documents for invoice INV-2026-2042 (consignee: Bata India).
We checked them against Bata India's requirements and need the corrections below
before we can release them.

Packing list (PL-2042.pdf)
  1. HS code: shows 6403.22; Bata India requires 6403.99.

Bill of lading (BL-2042.pdf)
  2. Gross weight: shows 950 kg; the packing list shows 900 kg.
     Please make the bill of lading match the packing list.

Please reply to this email with the corrected documents.

Regards,
CG Team
```

---

## 8. Cycles

- An SU reply in the thread (§4) creates cycle n+1 on the same shipment and runs **stage 1
  again**.
- The document set is the **latest version of each type**, plus all `OTHER` files. If SU
  resends only the packing list, the BOL and invoice from the previous cycle are reused.
- Failed files count from the latest cycle only.
- Files identical (same SHA-256) to an earlier version are flagged "unchanged". Their
  extraction is reused, and the draft mentions it.
- Review actions don't carry over; every cycle is checked fresh.
- A reply without attachments re-checks the carried-over documents. The SU message is shown
  to CG.
- If SU replies while a draft is unsent, the old draft is superseded and the check runs
  again.

---

## 9. Status lifecycle (`shipments.status`, plus `stage`)

```
RECEIVED → PROCESSING → NEEDS_REVIEW ──(CG clarify/amend)──┐
                      → AMENDMENT_READY ◄──────────────────┤ (stage 1 or 2)
                      → APPROVAL_READY  ◄──────────────────┘ (stage 2 only)
AMENDMENT_READY ──Send──► AMENDMENT_SENT ──SU reply──► PROCESSING (cycle+1, stage 1)
APPROVAL_READY  ──Send──► APPROVAL_SENT  (done)
FAILED: internal error where nothing could be evaluated
```

`stage` (`intake|validation`) shows where the shipment is.

The decision (`auto_approve | amendment_request | human_review`, Part 1 vocabulary) is stored
separately from the email state. `APPROVAL_READY` is used instead of "auto-approved", since
nothing is approved until the CG sends.

`headline` is a one-line summary for the 10-second view, for example:
- "Ready to approve: 5 rules and all cross-document checks passed"
- "Intake: 1 file could not be opened, resend request ready"
- "Needs your review: 2 items"
- "Processing 2 of 3 attachments"

---

## 10. Data model (migration `0003_shipments`)

New columns on `documents`: `shipment_id`, `inbound_email_id`, `cycle`, `doc_type`,
`doc_type_reason`, `unchanged_from_document_id`, plus
`UNIQUE(inbound_email_id, content_hash)`.
- SQLite treats NULLs as distinct, so Part 1 rows are unaffected.
- The new `documents` columns have no foreign keys. Adding them would make drizzle-kit
  rebuild the table, which fails on a database that already has runs. The ingestion code
  keeps the links consistent.
- `shipment_issues` also stores `request` and `allowed_actions_json`.
- `outbound_emails` also stores `from_address`.

| Table | Key columns |
|---|---|
| `shipments` | id, reference UNIQUE (`SHP-0001`), subject, supplier_name, supplier_address, customer_id, customer_resolution_status/reason, status, stage, decision, headline, reasoning, cycle, evaluation_hash, created_at, updated_at, evaluated_at |
| `inbound_emails` | id, shipment_id, cycle, message_id UNIQUE, from_name, from_address, reply_to, to_address, subject, body_text, sent_at, received_at, in_reply_to, references_json, raw_path |
| `shipment_fields` | shipment_id, field_name (UNIQUE pair), state, rule_status, consistency, owner_doc_type, value_text/value_number/unit, value_source (`document|cg`), source_document_id, rule_id, expected_label, confidence, reason, observations_json. Holds the latest evaluation only. |
| `shipment_issues` | shipment_id, cycle, issue_key (UNIQUE triple, migration 0005), stage, severity, kind, field_name, document_ids_json, found, expected, reference_json, message, request, allowed_actions_json. Kept per cycle: only the current cycle is re-evaluated, so earlier findings stay as history. |
| `review_actions` | id, shipment_id, cycle, issue_key, action (`clarify|amend|set_type`), value_text, note, actor, created_at. Append-only. |
| `outbound_emails` | id, shipment_id, cycle, stage, kind (`approval|amendment`), version, to_address, subject, body, generated_body, status (`draft|superseded|sent`), evaluation_hash, in_reply_to, message_id, created_at, updated_at, sent_at |
| `shipment_events` | id, shipment_id, type, message, data_json, created_at |
| view `email_log` | direction, shipment_id, cycle, from/to, subject, at (inbound + sent, **no bodies**) |

---

## 11. API contract (for the frontend agent)

All responses are JSON. Errors are `{ "error": { "code", "message" } }`. Poll
`GET /api/shipments` every 2 s while any shipment is `RECEIVED` or `PROCESSING`. Render email
bodies as **plain text**, never as HTML.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/inbox/samples` | – | `[{ name, subject, from, attachments: string[] }]` |
| POST | `/api/inbox/samples/:name/deliver` | – | `202 { file }` (the watcher ingests within ~2 s) |
| POST | `/api/inbox/emails` | multipart `file` (.eml) | `202 { shipmentId, emailId, cycle, duplicate }` |
| GET | `/api/shipments?status=&customerId=` | – | `ShipmentSummary[]` |
| GET | `/api/shipments/:id` | – | `ShipmentView` |
| DELETE | `/api/shipments/:id` | – | `{ deleted, shipmentId, reference, filesDeleted }`; `409 SHIPMENT_PROCESSING` while processing |
| POST | `/api/shipments/:id/review` | `{ issueKey, action: "clarify"\|"amend", value?, note? }` | `ShipmentView` |
| PUT | `/api/shipments/:id/documents/:documentId/type` | `{ docType, note? }` | `ShipmentView` (should) |
| PUT | `/api/shipments/:id/draft` | `{ version, to?, subject, body }` | `Draft` |
| POST | `/api/shipments/:id/draft/send` | `{ version }` | `{ sentEmail, status }` |
| GET | `/api/sent-emails` | – | `SentEmail[]` |
| GET | `/api/metrics` | – | `Metrics` (should) |
| GET | `/api/runs/:runId/document` | – | original attachment (existing endpoint) |
| POST | `/api/query` | `{ question }` | existing response shape |

New error codes:
- `SHIPMENT_NOT_FOUND`, `ISSUE_NOT_FOUND`, `SAMPLE_NOT_FOUND` (404)
- `EMAIL_INVALID`, `INVALID_ACTION`, `VALUE_REQUIRED`, `NOTE_REQUIRED` (400)
- `REVIEW_INCOMPLETE`, `DRAFT_OUTDATED`, `ALREADY_SENT`, `SHIPMENT_PROCESSING`,
  `RUN_PART_OF_SHIPMENT` (409)

`ShipmentSummary`:
```json
{ "id": "shp_…", "reference": "SHP-0002", "subject": "Shipment documents INV-2026-2042",
  "supplier": { "name": "Guangzhou Leatherworks", "address": "docs@gzleather.example" },
  "customer": { "name": "Bata India" }, "status": "AMENDMENT_READY", "stage": "validation",
  "decision": "amendment_request", "headline": "2 corrections needed: amendment draft ready",
  "cycle": 1, "attachments": 3, "openReviewItems": 0, "amendmentItems": 2,
  "receivedAt": "…", "updatedAt": "…" }
```

`ShipmentView` = summary fields plus:
```json
{
  "reasoning": "Intake passed: invoice, BOL and packing list received and readable. Customer resolved as Bata India. Validation: …",
  "customerResolution": { "status": "resolved", "name": "Bata India", "reason": "…" },
  "emails": [{ "id": "…", "cycle": 1, "from": "…", "subject": "…", "receivedAt": "…",
               "bodyText": "…", "documentIds": ["doc_…"] }],
  "progress": { "total": 3, "done": 3, "failed": 0 },
  "documents": [{ "id": "doc_…", "runId": "run_…", "filename": "PL-2042.pdf",
    "mimeType": "application/pdf", "size": 1711, "cycle": 1, "current": true,
    "unchangedFromCycle": null, "docType": "PACKING_LIST", "docTypeLabel": "Packing list",
    "docTypeReason": "Title reads \"PACKING LIST\"; model agrees",
    "status": "extracted", "error": null, "fileUrl": "/api/runs/run_…/document" }],
  "fields": [{ "field": "hs_code", "label": "HS code", "state": "amendment",
    "ruleStatus": "mismatch", "consistency": "inconsistent", "ownerDocType": null,
    "value": "6403.99", "unit": null, "valueSource": "document", "expected": "6403.99",
    "reason": "…",
    "observations": [{ "documentId": "doc_…", "filename": "PL-2042.pdf",
      "docType": "PACKING_LIST", "value": "6403.22", "unit": null, "confidence": 0.96,
      "confidenceLevel": "high", "reliable": true, "reasons": [],
      "evidence": "HS CODE: 6403.22", "evidenceStatus": "supported",
      "isOwner": false, "agrees": false }] }],
  "issues": [{ "key": "rule_mismatch:hs_code:doc_…", "stage": "validation",
    "severity": "amendment", "kind": "rule_mismatch", "field": "hs_code",
    "fieldLabel": "HS code",
    "documents": [{ "id": "doc_…", "filename": "PL-2042.pdf", "docType": "PACKING_LIST" }],
    "found": "6403.22", "expected": "6403.99",
    "reference": { "source": "rule", "ruleId": "rule_bata_hs_code" },
    "message": "…", "request": "…", "allowedActions": ["clarify"],
    "actionRules": { "clarify": { "value": "none", "note": "required" } },
    "resolution": null }],
  "draft": { "id": "…", "kind": "amendment", "version": 1, "to": "…", "subject": "…",
    "body": "…", "generatedBody": "…", "edited": false, "status": "draft",
    "previousVersionEdited": false, "canSend": true, "sendBlockedReason": null },
  "sent": [{ "id": "…", "kind": "amendment", "to": "…", "subject": "…", "sentAt": "…" }],
  "events": [{ "type": "email_received", "message": "Email from … with 3 attachments", "at": "…" }]
}
```

`confidenceLevel`:
- `low`: not reliable.
- `medium`: reliable but < 0.9.
- `high`: reliable and ≥ 0.9.

- `allowedActions` tells the UI which buttons to show.
- `actionRules` says, per action, whether a value or a note is required, so the UI can show
  the right inputs.
- `draft` is `null` while only review items are open.
- Field and doc-type labels come from the backend.

---

## 12. Query layer

- `ALLOWED_TABLES` += `shipments`, `shipment_fields`, `shipment_issues`, `review_actions`,
  `shipment_events`, `email_log`. Raw `inbound_emails` and `outbound_emails` stay excluded:
  their bodies are untrusted, long text.
- `SCHEMA_DESCRIPTION` describes the supplier-email tables first (what every status means,
  issue kinds and severities), then single uploads, plus a glossary of CG words:
  - "awaiting review" / "pending review" / "waiting for CG" = status in
    (`NEEDS_REVIEW`, `AMENDMENT_READY`, `APPROVAL_READY`): nothing is sent unreviewed.
  - "exceptions" / "needs attention" = `NEEDS_REVIEW`, `AMENDMENT_READY` (the Exceptions page).
  - "approved" = `APPROVAL_READY`, `APPROVAL_SENT`; "amendment requests" = `AMENDMENT_READY`,
    `AMENDMENT_SENT`; "waiting for supplier" = `AMENDMENT_SENT`.
  - "flagged" / "had a problem" = at least one `shipment_issues` row, any cycle.
  - "mismatches" (found vs expected) = issue kinds `rule_mismatch`, `document_mismatch`,
    `inconsistent`.
  - Shipments are named by `reference` and customers by `customers.name`, never by id.
- `email_log` carries the reply `kind` (approval / amendment, migration 0006), so "amendments
  sent" can be answered without email bodies.
- The SQL prompt forbids `SELECT *`, and results never include internal columns
  (`storage_path`, `raw_path`, `content_hash`, `evaluation_hash`).
- The answer prompt describes rows only as their columns show, so a list of documents is never
  called "approved" unless a status column says so.
- The SQL guard, read-only execution and row cap are unchanged.
- Checked against the real query model on four shipments (approval sent, amendment ready,
  amendment sent, needs review) with the Queries page suggestions.

---

## 13. Configuration (new environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `INBOX_DIR` | `./data/inbox` | folder the watcher polls |
| `INBOX_POLL_MS` | `2000` | poll interval (`0` disables the watcher, e.g. in tests) |
| `EMAIL_DIR` | `./data/emails` | stored raw `.eml` files |
| `SAMPLE_EMAILS_DIR` | `../samples/emails` | samples offered by `/api/inbox/samples` |
| `EXTRACTION_CONCURRENCY` | `2` | shared limit on parallel model calls |
| `MAX_ATTACHMENTS` | `10` | per email; extra files become failed files |
| `CG_MAILBOX` / `CG_SIGNATURE` | `cg@nova.local` / `CG Team` | reply sender and signature |

---

## 14. Failure handling

| Situation | Result |
|---|---|
| Duplicate `.eml` (same Message-ID) | no new rows; `duplicate: true` |
| Corrupt / unsupported / oversized file, or extraction failed after 3 attempts | stage 1 amendment: "please resend" |
| Email with no attachments | stage 1 amendment |
| `.eml` cannot be parsed | moved to `inbox/failed/`, logged; no shipment (no sender to reply to) |
| Process crashes mid-shipment | on boot: Part 1 run resume, then re-evaluate shipments in `RECEIVED`/`PROCESSING` |
| SU replies while CG is editing | new cycle; the stale send gets `409 DRAFT_OUTDATED` |
| Double click on Send | the second call gets `409 ALREADY_SENT` |
| Prompt injection in a document or email | documents: Part 1 untrusted-data prompt plus deterministic decisions; emails: the body never reaches an LLM |

---

## 15. Samples (`backend/scripts/make-samples.ts` → `samples/emails/`)

| Sample | Contents | Expected |
|---|---|---|
| `01-clean` | invoice, BOL, packing list, fumigation certificate | the certificate is tagged `OTHER`; `APPROVAL_READY` |
| `02-intake` | invoice, BOL, corrupt `scan_01.pdf` | stage 1 amendment: "resend scan_01.pdf; if it was not the packing list, send it too" |
| `02-intake-reply` | thread reply with the packing list | cycle 2 → stage 2 on the full set → `APPROVAL_READY` |
| `03-validation` | invoice, BOL (950 kg), packing list (HS 6403.22, 900 kg) | stage 2 amendment with 2 items, grouped by document |
| `03-validation-reply` | corrected PL and BOL | cycle 2 → `APPROVAL_READY` |
| `04-review` | invoice, BOL, packing list as a blurry scan | stage 1 review (unreadable HS code) → CG clarifies → stage 2 |

The PDFs come from the existing `pdf-lib` generator. The `.eml` files are built with
`nodemailer`'s `MailComposer` (a dev dependency only).

---

## 16. Tests

- **Pure** (`classifyDocument`, `intake`, `crossDocument`, `shipmentRouter`, `replyDraft`):
  - every row of the §5, §6.2 and §6.3 tables, including the port example;
  - review + amendment on the same screen;
  - the stage gate (no stage 2 while stage 1 has amendments);
  - waiving an item needs a note.
- **Ingestion** (generated `.eml`, temp DB, fake extractor): duplicate Message-ID; the same
  file twice; an unchanged file in a new cycle (extraction reused); threading by header and
  by subject tag; inline images skipped; MIME sniffing.
- **API** (supertest): edit + send → Sent Emails; no send → still a draft;
  `REVIEW_INCOMPLETE`; `DRAFT_OUTDATED`; `ALREADY_SENT`; review-action validation.
- **Query:** the validator allows the new tables; "pending review for customer X" SQL over a
  seeded shipment.
- **Regression:** all Part 1 tests stay green, unchanged.
- **Live:** the sample emails through real Gemini before merging.

---

## 17. Build plan

Work on branch `part2/inbox-shipments`, test at every step, and merge to `main` only when
everything passes.

| # | Step | Estimate |
|---|---|---|
| 1 | Zod contracts, migration 0003, freeze this API contract (the frontend can start) | 45 min |
| 2 | `.eml` parsing, idempotent ingest, threading, watcher, deliver/upload endpoints | 1 h |
| 3 | Extract-only runs, classification, shared limiter, unchanged-file reuse, resume | 45 min |
| 4 | Stage 1 + stage 2 + router + drafts (pure, most tests) | 1.5 h |
| 5 | Review actions, draft edit/send gate, Sent Emails, events, views | 1 h |
| 6 | Query layer, samples, live Gemini run, README/DECISIONS (ID-11) | 1.5 h |

**Cut line if time runs short:** drop the doc-type override (CG then uses `amend`), metrics
and the second customer.

---

## 18. Differences from the Part 2 brief

1. **Two-stage gate:** validation runs only after a clean intake; each stage sends at most
   one email.
2. **Owner logic with a rule guard:** the owner is checked first (readable? passes the
   rule?). Only a correct owner is the reference that other documents must match. A
   reliable disagreement is an amendment, not information only.
3. **Agent unsure → review; document wrong → amendment.** Review items are resolved by CG
   (clarify or amend) on the same screen as amendment items.
4. **Description of goods is not compared for equality** (UCP 600 art. 14(e)).
5. **Status names:** `APPROVAL_READY` instead of `AUTO_APPROVED`; no `VERIFIED` state.
6. **Express, not Fastify.** The repository was restructured (DECISIONS ID-10).

## 19. Known limitations

- Port aliases (Nhava Sheva vs Mumbai) are not mapped; a UN/LOCODE table is the next step.
- A BOL consignee written "TO ORDER" (or to a bank) shows as a consignee disagreement.
- Combined "invoice cum packing list" documents are classified `OTHER`.
- The watcher runs in a single process: one instance only, no queue.
- Confidence is uncalibrated. Scans have no text-layer check (they are marked `unverified`,
  as in Part 1).
- The approved document set is not forwarded to the customer.
