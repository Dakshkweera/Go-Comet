DROP INDEX `idx_shipment_issues_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipment_issues_cycle_key` ON `shipment_issues` (`shipment_id`,`cycle`,`issue_key`);