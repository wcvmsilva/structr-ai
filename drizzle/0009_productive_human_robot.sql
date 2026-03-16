ALTER TABLE `clients` ADD `billing_address_line1` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `billing_address_line2` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `billing_city` varchar(128);--> statement-breakpoint
ALTER TABLE `clients` ADD `billing_state` varchar(2);--> statement-breakpoint
ALTER TABLE `clients` ADD `billing_zip` varchar(10);--> statement-breakpoint
ALTER TABLE `clients` ADD `shipping_address_line1` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `shipping_address_line2` varchar(255);--> statement-breakpoint
ALTER TABLE `clients` ADD `shipping_city` varchar(128);--> statement-breakpoint
ALTER TABLE `clients` ADD `shipping_state` varchar(2);--> statement-breakpoint
ALTER TABLE `clients` ADD `shipping_zip` varchar(10);--> statement-breakpoint
ALTER TABLE `clients` ADD `updated_by` int;--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `service_type` varchar(128);--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `area` varchar(255);--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `finish_level` enum('standard','premium','luxury') DEFAULT 'standard';--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `condition` varchar(255);--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `created_by` int;--> statement-breakpoint
ALTER TABLE `intake_forms` ADD `updated_by` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `state` varchar(2) DEFAULT 'SC';--> statement-breakpoint
ALTER TABLE `projects` ADD `zip_code` varchar(10);--> statement-breakpoint
ALTER TABLE `projects` ADD `region` varchar(80);--> statement-breakpoint
ALTER TABLE `projects` ADD `zone` varchar(80);--> statement-breakpoint
ALTER TABLE `projects` ADD `project_type` enum('remodel','new_construction','repair','insurance_restoration','commercial_buildout','addition','exterior') DEFAULT 'remodel';--> statement-breakpoint
ALTER TABLE `projects` ADD `updated_by` int;--> statement-breakpoint
CREATE INDEX `idx_intake_service` ON `intake_forms` (`service_type`);--> statement-breakpoint
CREATE INDEX `idx_projects_region` ON `projects` (`region`);--> statement-breakpoint
CREATE INDEX `idx_projects_type` ON `projects` (`project_type`);