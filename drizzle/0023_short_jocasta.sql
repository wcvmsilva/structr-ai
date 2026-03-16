CREATE TABLE `field_feedback_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`project_id` int,
	`estimate_id` int,
	`user_id` int NOT NULL,
	`issue_type` enum('pricing_inaccuracy','scope_mismatch','material_unavailable','labor_shortage','timeline_issue','quality_concern','client_complaint','safety_issue','other') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`description` text NOT NULL,
	`resolution` text,
	`status` enum('open','in_review','resolved','dismissed') NOT NULL DEFAULT 'open',
	`resolved_by` int,
	`resolved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `field_feedback_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text NOT NULL,
	`description` varchar(512),
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_key_unique` UNIQUE(`key`),
	CONSTRAINT `idx_ss_key` UNIQUE(`key`)
);
--> statement-breakpoint
ALTER TABLE `project_actuals` ADD `variance_amount` decimal(14,2);--> statement-breakpoint
ALTER TABLE `project_actuals` ADD `is_high_variance` boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_ffr_project` ON `field_feedback_reports` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_ffr_estimate` ON `field_feedback_reports` (`estimate_id`);--> statement-breakpoint
CREATE INDEX `idx_ffr_user` ON `field_feedback_reports` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_ffr_type` ON `field_feedback_reports` (`issue_type`);--> statement-breakpoint
CREATE INDEX `idx_ffr_severity` ON `field_feedback_reports` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_ffr_status` ON `field_feedback_reports` (`status`);