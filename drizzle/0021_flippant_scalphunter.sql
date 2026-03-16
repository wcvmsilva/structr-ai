CREATE TABLE `pipeline_partial_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scope_draft_id` int NOT NULL,
	`user_id` int NOT NULL,
	`failed_step` varchar(128) NOT NULL,
	`error_code` varchar(64) NOT NULL,
	`error_message` text NOT NULL,
	`partial_payload` json,
	`context_snapshot` json,
	`retry_count` int NOT NULL DEFAULT 0,
	`max_retries` int NOT NULL DEFAULT 3,
	`status` enum('pending','retrying','recovered','abandoned') NOT NULL DEFAULT 'pending',
	`recovered_estimate_id` int,
	`recovered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pipeline_partial_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_issue_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reported_by` int NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` int NOT NULL,
	`issue_category` enum('pricing_mismatch','missing_assembly','wrong_multiplier','scope_error','ui_bug','data_integrity','other') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`metadata` json,
	`status` enum('open','acknowledged','investigating','resolved','dismissed') NOT NULL DEFAULT 'open',
	`resolved_by` int,
	`resolved_at` timestamp,
	`resolution_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_issue_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ppd_scope_draft` ON `pipeline_partial_drafts` (`scope_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_ppd_user` ON `pipeline_partial_drafts` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ppd_status` ON `pipeline_partial_drafts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ppd_error_code` ON `pipeline_partial_drafts` (`error_code`);--> statement-breakpoint
CREATE INDEX `idx_sir_entity` ON `system_issue_reports` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_sir_category` ON `system_issue_reports` (`issue_category`);--> statement-breakpoint
CREATE INDEX `idx_sir_status` ON `system_issue_reports` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sir_reported_by` ON `system_issue_reports` (`reported_by`);--> statement-breakpoint
CREATE INDEX `idx_sir_severity` ON `system_issue_reports` (`severity`);