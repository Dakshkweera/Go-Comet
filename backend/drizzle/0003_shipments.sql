CREATE TABLE `inbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`cycle` integer NOT NULL,
	`message_id` text NOT NULL,
	`from_name` text,
	`from_address` text NOT NULL,
	`reply_to` text,
	`to_address` text,
	`subject` text NOT NULL,
	`body_text` text DEFAULT '' NOT NULL,
	`sent_at` text,
	`received_at` text NOT NULL,
	`in_reply_to` text,
	`references_json` text DEFAULT '[]' NOT NULL,
	`raw_path` text NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbound_emails_message_id_unique` ON `inbound_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_inbound_emails_shipment` ON `inbound_emails` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `outbound_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`cycle` integer NOT NULL,
	`stage` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`generated_body` text NOT NULL,
	`status` text NOT NULL,
	`evaluation_hash` text NOT NULL,
	`in_reply_to` text,
	`message_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbound_emails_message_id_unique` ON `outbound_emails` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_outbound_emails_shipment` ON `outbound_emails` (`shipment_id`);--> statement-breakpoint
CREATE INDEX `idx_outbound_emails_status` ON `outbound_emails` (`status`);--> statement-breakpoint
CREATE TABLE `review_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`cycle` integer NOT NULL,
	`issue_key` text NOT NULL,
	`action` text NOT NULL,
	`value_text` text,
	`note` text,
	`actor` text DEFAULT 'CG operator' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_review_actions_shipment` ON `review_actions` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `shipment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`data_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_shipment_events_shipment` ON `shipment_events` (`shipment_id`);--> statement-breakpoint
CREATE TABLE `shipment_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`field_name` text NOT NULL,
	`state` text NOT NULL,
	`rule_status` text NOT NULL,
	`consistency` text NOT NULL,
	`owner_doc_type` text,
	`value_text` text,
	`value_number` real,
	`unit` text,
	`value_source` text,
	`source_document_id` text,
	`rule_id` text,
	`expected_label` text,
	`confidence` real,
	`reason` text NOT NULL,
	`observations_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipment_fields_field` ON `shipment_fields` (`shipment_id`,`field_name`);--> statement-breakpoint
CREATE TABLE `shipment_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_id` text NOT NULL,
	`issue_key` text NOT NULL,
	`cycle` integer NOT NULL,
	`stage` text NOT NULL,
	`severity` text NOT NULL,
	`kind` text NOT NULL,
	`field_name` text,
	`document_ids_json` text DEFAULT '[]' NOT NULL,
	`found` text,
	`expected` text,
	`reference_json` text,
	`message` text NOT NULL,
	`request` text NOT NULL,
	`allowed_actions_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_shipment_issues_key` ON `shipment_issues` (`shipment_id`,`issue_key`);--> statement-breakpoint
CREATE INDEX `idx_shipment_issues_kind` ON `shipment_issues` (`kind`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`subject` text NOT NULL,
	`supplier_name` text,
	`supplier_address` text NOT NULL,
	`customer_id` text,
	`customer_resolution_status` text,
	`customer_resolution_reason` text,
	`status` text NOT NULL,
	`stage` text,
	`decision` text,
	`headline` text,
	`reasoning` text,
	`cycle` integer DEFAULT 1 NOT NULL,
	`evaluation_hash` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`evaluated_at` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipments_reference_unique` ON `shipments` (`reference`);--> statement-breakpoint
CREATE INDEX `idx_shipments_status` ON `shipments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_shipments_customer` ON `shipments` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_shipments_created_at` ON `shipments` (`created_at`);--> statement-breakpoint
ALTER TABLE `documents` ADD `shipment_id` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `inbound_email_id` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `cycle` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `doc_type` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `doc_type_reason` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `unchanged_from_document_id` text;--> statement-breakpoint
CREATE INDEX `idx_documents_shipment` ON `documents` (`shipment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_documents_email_hash` ON `documents` (`inbound_email_id`,`content_hash`);