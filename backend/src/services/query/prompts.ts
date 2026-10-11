export const SCHEMA_DESCRIPTION = `SQLite tables (timestamps are ISO-8601 UTC text):
customers(id, name, normalized_name)
customer_rules(id, customer_id, field, operator [EXACT|MIN|MAX|RANGE], expected_value, min_value, max_value, unit, is_active)
documents(id, original_filename, mime_type, file_size, created_at)
pipeline_runs(id, document_id, status [RECEIVED|PROCESSING|COMPLETED|FAILED], current_stage, customer_id, customer_resolution_status [resolved|not_found|ambiguous], final_decision [auto_approve|human_review|amendment_request], final_reasoning, error_code, created_at, completed_at)
extractions(id, run_id, field_name, value_text, value_number, unit, confidence, evidence)
validation_results(id, run_id, field_name, status [match|mismatch|uncertain], found_text, found_number, expected_text, expected_min, expected_max, unit, confidence, reason)
decisions(id, run_id, decision, reasoning, amendment_draft, created_at)
shipments(id, reference e.g. 'SHP-0001', subject, supplier_name, supplier_address, customer_id, status [RECEIVED|PROCESSING|NEEDS_REVIEW|AMENDMENT_READY|APPROVAL_READY|AMENDMENT_SENT|APPROVAL_SENT|FAILED], stage [intake|validation], decision [auto_approve|human_review|amendment_request], headline, reasoning, cycle, created_at, updated_at)
shipment_fields(shipment_id, field_name, state [ok|amendment|review], rule_status, consistency, value_text, value_number, unit, expected_label, confidence)
shipment_issues(shipment_id, issue_key, cycle, stage, severity [review|amendment], kind, field_name, found, expected, message)
review_actions(shipment_id, cycle, issue_key, action [clarify|amend|set_type], value_text, note, created_at)
shipment_events(shipment_id, type, message, created_at)
email_log(direction [inbound|outbound], shipment_id, cycle, from_address, to_address, subject, at)
documents also has shipment_id, cycle and doc_type [COMMERCIAL_INVOICE|BOL|PACKING_LIST|CERTIFICATE_OF_ORIGIN|OTHER].
field_name values: consignee_name, hs_code, port_of_loading, port_of_discharge, incoterms, description_of_goods, gross_weight (value_number), invoice_number.
Glossary:
- A "shipment" is a row in shipments (one supplier email thread); its customer is customers.name via shipments.customer_id. Name shipments by shipments.reference, never by id.
- shipment_issues keeps every cycle's findings: current ones have shipment_issues.cycle = shipments.cycle; "had a problem" includes earlier cycles.
- "Pending review" or "waiting for CG" means shipments.status IN ('NEEDS_REVIEW','AMENDMENT_READY','APPROVAL_READY').
- "Flagged" or "needs human review" means shipments.status = 'NEEDS_REVIEW'. "Waiting for the supplier" means status = 'AMENDMENT_SENT'.
- "Uploaded documents" are single uploads: pipeline_runs joined to documents WHERE documents.shipment_id IS NULL; their decision is pipeline_runs.final_decision.`;

export const CLASSIFY_PROMPT = `Classify the user's question about a trade-document processing system.
Return JSON {"type": "database_query" | "general_question", "reason": "<short reason>"}.
Use "database_query" whenever the answer depends on stored shipments, documents, runs, decisions, extractions or customers.
Use "general_question" only for definitions or how the system works.`;

export const SQL_PROMPT = `Write one read-only SQLite SELECT query that answers the question.
${SCHEMA_DESCRIPTION}
Use date('now', '-7 days') style expressions for relative dates; "this week" means the last 7 days.
Return JSON {"sql": "<query>"} with no comments and no trailing semicolon.`;

export const ANSWER_PROMPT = `Answer the question using only the query result provided. Do not add facts that are not in the result.
Be concise and mention counts and file names where relevant.
Return JSON {"answer": "<answer>"}.`;

export const GENERAL_PROMPT = `You explain a trade-document pipeline that extracts fields (consignee, HS code, ports, Incoterms, goods, gross weight, invoice number) from documents with a vision model, validates them against customer rules (match/mismatch/uncertain) and routes each shipment to auto-approve, human review or amendment request. Supplier emails become shipments: every attachment is read, intake is checked first, then the documents are validated against the rules and against each other, and a CG operator reviews and sends the reply draft.
Answer general questions briefly. Never state numbers about stored shipments.
Return JSON {"answer": "<answer>"}.`;
