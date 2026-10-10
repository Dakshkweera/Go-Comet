CREATE TABLE `customer_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`field` text NOT NULL,
	`operator` text NOT NULL,
	`expected_value` text,
	`min_value` real,
	`max_value` real,
	`unit` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_customer_rules_customer` ON `customer_rules` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_normalized_name_unique` ON `customers` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`decision` text NOT NULL,
	`reasoning` text NOT NULL,
	`discrepancies_json` text DEFAULT '[]' NOT NULL,
	`amendment_draft` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `decisions_run_id_unique` ON `decisions` (`run_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`original_filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`storage_path` text NOT NULL,
	`content_hash` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `extractions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`field_name` text NOT NULL,
	`value_text` text,
	`value_number` real,
	`unit` text,
	`confidence` real NOT NULL,
	`evidence` text,
	`candidates_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_extractions_run_field` ON `extractions` (`run_id`,`field_name`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`status` text NOT NULL,
	`current_stage` text NOT NULL,
	`customer_id` text,
	`customer_resolution_status` text,
	`customer_resolution_reason` text,
	`final_decision` text,
	`final_reasoning` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_status` ON `pipeline_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_decision` ON `pipeline_runs` (`final_decision`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_created_at` ON `pipeline_runs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_customer` ON `pipeline_runs` (`customer_id`);--> statement-breakpoint
CREATE TABLE `pipeline_stage_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`error_code` text,
	`error_message` text,
	`metadata_json` text,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stage_runs_run` ON `pipeline_stage_runs` (`run_id`);--> statement-breakpoint
CREATE TABLE `validation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`field_name` text NOT NULL,
	`status` text NOT NULL,
	`found_text` text,
	`found_number` real,
	`expected_text` text,
	`expected_number` real,
	`expected_min` real,
	`expected_max` real,
	`unit` text,
	`confidence` real,
	`rule_id` text,
	`rule_operator` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `customer_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_validation_run` ON `validation_results` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_validation_status` ON `validation_results` (`status`);