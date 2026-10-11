-- Adds the reply kind, so questions such as "amendments sent this week" can be answered without email bodies.
DROP VIEW IF EXISTS `email_log`;
--> statement-breakpoint
CREATE VIEW `email_log` AS
SELECT 'inbound' AS direction, NULL AS kind, shipment_id, cycle, from_address, to_address, subject, received_at AS at
FROM inbound_emails
UNION ALL
SELECT 'outbound' AS direction, kind, shipment_id, cycle, from_address, to_address, subject, sent_at AS at
FROM outbound_emails
WHERE status = 'sent';
