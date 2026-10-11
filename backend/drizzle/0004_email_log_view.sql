-- Email headers for the query layer; bodies are untrusted supplier text and stay out of it.
CREATE VIEW `email_log` AS
SELECT 'inbound' AS direction, shipment_id, cycle, from_address, to_address, subject, received_at AS at
FROM inbound_emails
UNION ALL
SELECT 'outbound' AS direction, shipment_id, cycle, from_address, to_address, subject, sent_at AS at
FROM outbound_emails
WHERE status = 'sent';
