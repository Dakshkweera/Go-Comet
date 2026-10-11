export const SCHEMA_DESCRIPTION = `SQLite database of a trade-document checking system. Timestamps are ISO-8601 UTC text such as '2026-10-11T09:15:00.000Z'.

Supplier emails (the main data). One supplier email thread is one shipment; a supplier reply in the thread is the next cycle.
shipments(id, reference e.g. 'SHP-0001', subject, supplier_name, supplier_address, customer_id, status, stage [intake|validation], decision [auto_approve|human_review|amendment_request], headline, reasoning, cycle, created_at = when the first email arrived, updated_at)
  status: RECEIVED or PROCESSING = attachments being read; NEEDS_REVIEW = Nova is unsure and the CG must decide; AMENDMENT_READY = problems found, correction email drafted, not sent yet; APPROVAL_READY = every check passed, approval drafted, not sent yet; AMENDMENT_SENT = correction sent, waiting for the supplier; APPROVAL_SENT = approved and sent, done; FAILED = processing error.
documents(id, shipment_id, cycle, original_filename, doc_type [COMMERCIAL_INVOICE|BOL|PACKING_LIST|CERTIFICATE_OF_ORIGIN|OTHER], mime_type, file_size, created_at). doc_type NULL means the file could not be read.
shipment_issues(shipment_id, cycle, stage, severity [review|amendment], kind, field_name, found, expected, message): every problem Nova raised, kept for every cycle. severity 'amendment' = the supplier must fix it; 'review' = the CG must check it. kind: rule_mismatch (breaks a customer rule), document_mismatch (differs from the document that owns the field), inconsistent (documents disagree), attachment_failed, missing_document, missing_field, unreliable_value, duplicate_type_conflict, customer_unresolved, no_rules, cannot_verify, other_document_mismatch, no_attachments.
shipment_fields(shipment_id, field_name, state [ok|amendment|review], value_text, value_number, unit, expected_label, confidence): the current value of each field of a shipment.
review_actions(shipment_id, cycle, issue_key, action [clarify|amend|set_type], value_text, note, created_at): decisions made by the CG operator.
shipment_events(shipment_id, type, message, created_at): the shipment timeline.
email_log(direction [inbound|outbound], kind [approval|amendment, outbound only], shipment_id, cycle, from_address, to_address, subject, at): emails received and replies sent (sending is simulated).
customers(id, name, normalized_name); customer_rules(id, customer_id, field, operator [EXACT|MIN|MAX|RANGE], expected_value, min_value, max_value, unit, is_active).
pipeline_runs(id, document_id, status, error_code, final_decision, created_at): one per document read; for email attachments final_decision is NULL and error_code set means the file could not be read.
extractions(run_id, field_name, value_text, value_number, unit, confidence, evidence): the values read from each document; join extractions.run_id = pipeline_runs.id and pipeline_runs.document_id = documents.id.

Single uploaded documents (checked one at a time, not from email): documents WHERE shipment_id IS NULL, joined to pipeline_runs. Their outcome is pipeline_runs.final_decision [auto_approve|human_review|amendment_request]; rule results are in validation_results(run_id, field_name, status [match|mismatch|uncertain], found_text, found_number, expected_text, expected_min, expected_max, unit, reason) and decisions(run_id, decision, reasoning, amendment_draft, created_at).

field_name values: consignee_name, hs_code, port_of_loading, port_of_discharge, incoterms, description_of_goods, gross_weight (value_number with unit), invoice_number.

What the words mean (follow these):
- "shipment" = a row in shipments. Name shipments by shipments.reference, never by id. For the customer, join customers and show customers.name, never customer_id.
- "awaiting review", "pending review", "awaiting human review", "to review", "waiting for the CG" = shipments.status IN ('NEEDS_REVIEW','AMENDMENT_READY','APPROVAL_READY'): nothing is sent until the CG reviews it.
- "exceptions" or "needs attention" = shipments.status IN ('NEEDS_REVIEW','AMENDMENT_READY').
- "unsure", "needs a decision", "NEEDS_REVIEW" = shipments.status = 'NEEDS_REVIEW'.
- "approved" = shipments.status IN ('APPROVAL_READY','APPROVAL_SENT'); "approval sent" = 'APPROVAL_SENT'. Approved documents = documents of approved shipments.
- "amendment requests" or "corrections" = shipments.status IN ('AMENDMENT_READY','AMENDMENT_SENT'); "amendments sent" = email_log WHERE direction = 'outbound' AND kind = 'amendment'.
- "waiting for the supplier" = shipments.status = 'AMENDMENT_SENT'.
- "flagged", "had a problem", "had an issue" = shipments with at least one shipment_issues row (any cycle); filter field_name or kind for a specific problem.
- "mismatches" or "discrepancies" (found vs expected) = shipment_issues WHERE kind IN ('rule_mismatch','document_mismatch','inconsistent') (field_name, found, expected, message); add validation_results WHERE status = 'mismatch' only for single uploaded documents.
- "problems the supplier must fix" = shipment_issues WHERE severity = 'amendment' (this includes missing or unreadable files).
- "today", "this week" filter shipments.created_at (when the email arrived), or email_log.at for replies sent.
- Single uploaded documents only when the question mentions uploads, runs or single documents.`;

export const CLASSIFY_PROMPT = `Classify the user's question about a trade-document processing system.
Return JSON {"type": "database_query" | "general_question", "reason": "<short reason>"}.
Use "database_query" whenever the answer depends on stored shipments, supplier emails, replies, documents, issues, decisions, extractions or customers.
Use "general_question" only for definitions or how the system works.`;

export const SQL_PROMPT = `Write one read-only SQLite SELECT query that answers the question.
${SCHEMA_DESCRIPTION}
Select only the columns needed to answer, never SELECT *; prefer readable columns (shipments.reference, shipments.status, customers.name, documents.original_filename) over ids.
For relative dates compare with date() or datetime(): date(created_at) = date('now') for today, datetime(created_at) >= datetime('now', '-7 days') for this week.
Return JSON {"sql": "<query>"} with no comments and no trailing semicolon.`;

export const ANSWER_PROMPT = `Answer the question using only the query result provided. Do not add facts that are not in the result.
Describe the rows only as what their columns show: never call a record approved, flagged, sent or anything else unless a column in the result says so. If the rows do not fully answer the question, say what they do show.
Be concise, name shipments by reference, and mention counts and file names where relevant.
Return JSON {"answer": "<answer>"}.`;

export const GENERAL_PROMPT = `You explain a trade-document pipeline that extracts fields (consignee, HS code, ports, Incoterms, goods, gross weight, invoice number) from documents with a vision model, validates them against customer rules (match/mismatch/uncertain) and routes each shipment to auto-approve, human review or amendment request. Supplier emails become shipments: every attachment is read, intake is checked first, then the documents are validated against the rules and against each other, and a CG operator reviews and sends the reply draft.
Answer general questions briefly. Never state numbers about stored shipments.
Return JSON {"answer": "<answer>"}.`;
