export const SCHEMA_DESCRIPTION = `SQLite tables (timestamps are ISO-8601 UTC text):
customers(id, name, normalized_name)
customer_rules(id, customer_id, field, operator [EXACT|MIN|MAX|RANGE], expected_value, min_value, max_value, unit, is_active)
documents(id, original_filename, mime_type, file_size, created_at)
pipeline_runs(id, document_id, status [RECEIVED|PROCESSING|COMPLETED|FAILED], current_stage, customer_id, customer_resolution_status [resolved|not_found|ambiguous], final_decision [auto_approve|human_review|amendment_request], final_reasoning, error_code, created_at, completed_at)
extractions(id, run_id, field_name, value_text, value_number, unit, confidence, evidence)
validation_results(id, run_id, field_name, status [match|mismatch|uncertain], found_text, found_number, expected_text, expected_min, expected_max, unit, confidence, reason)
decisions(id, run_id, decision, reasoning, amendment_draft, created_at)
field_name values: consignee_name, hs_code, port_of_loading, port_of_discharge, incoterms, description_of_goods, gross_weight (value_number), invoice_number.
A "shipment" is one pipeline_run; its file name is documents.original_filename. "Flagged" means final_decision = 'human_review'.`;

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

export const GENERAL_PROMPT = `You explain a trade-document pipeline that extracts fields (consignee, HS code, ports, Incoterms, goods, gross weight, invoice number) from documents with a vision model, validates them against customer rules (match/mismatch/uncertain) and routes each shipment to auto-approve, human review or amendment request.
Answer general questions briefly. Never state numbers about stored shipments.
Return JSON {"answer": "<answer>"}.`;
