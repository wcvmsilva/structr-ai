CREATE TABLE `assembly_components` (
	`id` int AUTO_INCREMENT NOT NULL,
	`assembly_id` int NOT NULL,
	`price_book_item_id` int,
	`catalog_item_id` int,
	`description` varchar(255),
	`quantity` decimal(10,4) NOT NULL DEFAULT '1.0000',
	`waste_factor_pct` decimal(5,2) DEFAULT '0.00',
	`unit_cost_override` decimal(10,4),
	`sort_order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assembly_components_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`action` varchar(80) NOT NULL,
	`table_name` varchar(80) NOT NULL,
	`record_id` int,
	`before_snapshot` json,
	`after_snapshot` json,
	`ip_address` varchar(45),
	`user_agent` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uuid` char(36) NOT NULL,
	`first_name` varchar(80) NOT NULL,
	`last_name` varchar(80) NOT NULL,
	`company_name` varchar(160),
	`email` varchar(255),
	`phone` varchar(30),
	`address` text,
	`city` varchar(128) DEFAULT 'Charleston',
	`state` varchar(2) DEFAULT 'SC',
	`zip` varchar(10),
	`county` varchar(128),
	`channel` enum('residential','commercial','insurance','direct') NOT NULL DEFAULT 'residential',
	`source` varchar(100),
	`notes` text,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_uuid_unique` UNIQUE(`uuid`)
);
--> statement-breakpoint
CREATE TABLE `estimate_line_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`estimate_id` int NOT NULL,
	`price_book_item_id` int,
	`catalog_item_id` int,
	`cost_group_name` varchar(255) NOT NULL,
	`cost_item_name` varchar(512) NOT NULL,
	`description` text,
	`unit` varchar(32) NOT NULL,
	`quantity` decimal(10,2) NOT NULL DEFAULT '1',
	`unit_cost` decimal(12,2) NOT NULL,
	`unit_price` decimal(12,2) NOT NULL,
	`line_total_cost` decimal(14,2) NOT NULL,
	`line_total_price` decimal(14,2) NOT NULL,
	`gross_profit_pct` decimal(5,2),
	`sort_order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `estimate_line_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uuid` char(36) NOT NULL,
	`project_id` int,
	`client_id` int,
	`estimate_draft_id` int,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','pending_review','approved','sent','accepted','rejected','expired') NOT NULL DEFAULT 'draft',
	`channel` enum('residential','commercial','insurance') DEFAULT 'residential',
	`subtotal_cost` decimal(14,2) NOT NULL,
	`subtotal_price` decimal(14,2) NOT NULL,
	`gross_profit` decimal(14,2) NOT NULL,
	`gross_profit_pct` decimal(5,2) NOT NULL,
	`discount_pct` decimal(5,2) DEFAULT '0.00',
	`discount_amount` decimal(14,2) DEFAULT '0.00',
	`tax_amount` decimal(14,2) DEFAULT '0.00',
	`final_total` decimal(14,2) NOT NULL,
	`profit_shield_min_pct` decimal(5,2) DEFAULT '35.00',
	`valid_until` timestamp,
	`notes` text,
	`internal_notes` text,
	`metadata` json,
	`created_by` int,
	`approved_by` int,
	`approved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	CONSTRAINT `estimates_id` PRIMARY KEY(`id`),
	CONSTRAINT `estimates_uuid_unique` UNIQUE(`uuid`)
);
--> statement-breakpoint
CREATE TABLE `intake_forms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uuid` char(36) NOT NULL,
	`project_id` int,
	`client_id` int,
	`channel` enum('residential','commercial','insurance') DEFAULT 'residential',
	`raw_payload` json NOT NULL,
	`parsed_scope` json,
	`confidence_score` decimal(5,2),
	`status` enum('received','parsing','parsed','reviewed','converted') NOT NULL DEFAULT 'received',
	`processed_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `intake_forms_id` PRIMARY KEY(`id`),
	CONSTRAINT `intake_forms_uuid_unique` UNIQUE(`uuid`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`resource` varchar(80) NOT NULL,
	`action` varchar(30) NOT NULL,
	`description` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_book_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`price_book_item_id` int NOT NULL,
	`old_unit_cost` decimal(10,4) NOT NULL,
	`new_unit_cost` decimal(10,4) NOT NULL,
	`old_unit_price` decimal(10,4) NOT NULL,
	`new_unit_price` decimal(10,4) NOT NULL,
	`changed_by` int,
	`reason` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `price_book_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `price_book_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`uuid` char(36) NOT NULL,
	`sku` varchar(80) NOT NULL,
	`category` varchar(100) NOT NULL,
	`subcategory` varchar(100),
	`name` varchar(255) NOT NULL,
	`description` text,
	`unit_of_measure` varchar(30) NOT NULL,
	`unit_cost` decimal(10,4) NOT NULL,
	`unit_price` decimal(10,4) NOT NULL,
	`is_admin_fee` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`last_cost_updated_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`deleted_at` timestamp,
	`cost_code` varchar(16),
	`cost_type` varchar(64),
	`taxable` boolean DEFAULT true,
	CONSTRAINT `price_book_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `price_book_items_uuid_unique` UNIQUE(`uuid`),
	CONSTRAINT `price_book_items_sku_unique` UNIQUE(`sku`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role_id` int NOT NULL,
	`permission_id` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(50) NOT NULL,
	`description` varchar(255),
	`is_system` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `scope_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`intake_form_id` int NOT NULL,
	`assembly_id` int,
	`suggested_scope` text NOT NULL,
	`confidence_score` decimal(5,2),
	`estimated_cost` decimal(12,2),
	`estimated_price` decimal(12,2),
	`status` enum('pending','accepted','rejected','modified') NOT NULL DEFAULT 'pending',
	`reviewed_by` int,
	`review_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scope_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `assemblies` ADD `uuid` char(36);--> statement-breakpoint
ALTER TABLE `assemblies` ADD `trade` varchar(80);--> statement-breakpoint
ALTER TABLE `assemblies` ADD `unit_of_measure` varchar(30);--> statement-breakpoint
ALTER TABLE `assemblies` ADD `is_preset` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `version` int DEFAULT 1;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `created_by` int;--> statement-breakpoint
ALTER TABLE `assemblies` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `projects` ADD `uuid` char(36);--> statement-breakpoint
ALTER TABLE `projects` ADD `client_id` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `profit_shield_min_pct` decimal(5,2) DEFAULT '35.00';--> statement-breakpoint
ALTER TABLE `projects` ADD `deleted_at` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `uuid` char(36);--> statement-breakpoint
ALTER TABLE `users` ADD `role_id` int;--> statement-breakpoint
ALTER TABLE `users` ADD `is_active` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_ac_assembly` ON `assembly_components` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_ac_pbi` ON `assembly_components` (`price_book_item_id`);--> statement-breakpoint
CREATE INDEX `idx_ac_catalog` ON `assembly_components` (`catalog_item_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_user` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_table` ON `audit_logs` (`table_name`);--> statement-breakpoint
CREATE INDEX `idx_audit_action` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_clients_email` ON `clients` (`email`);--> statement-breakpoint
CREATE INDEX `idx_clients_channel` ON `clients` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_clients_active` ON `clients` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_eli_estimate` ON `estimate_line_items` (`estimate_id`);--> statement-breakpoint
CREATE INDEX `idx_eli_pbi` ON `estimate_line_items` (`price_book_item_id`);--> statement-breakpoint
CREATE INDEX `idx_eli_catalog` ON `estimate_line_items` (`catalog_item_id`);--> statement-breakpoint
CREATE INDEX `idx_estimates_project` ON `estimates` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_estimates_client` ON `estimates` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_estimates_status` ON `estimates` (`status`);--> statement-breakpoint
CREATE INDEX `idx_estimates_draft` ON `estimates` (`estimate_draft_id`);--> statement-breakpoint
CREATE INDEX `idx_intake_project` ON `intake_forms` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_intake_client` ON `intake_forms` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_intake_status` ON `intake_forms` (`status`);--> statement-breakpoint
CREATE INDEX `idx_perm_resource` ON `permissions` (`resource`);--> statement-breakpoint
CREATE INDEX `idx_pbh_item` ON `price_book_history` (`price_book_item_id`);--> statement-breakpoint
CREATE INDEX `idx_pbh_created` ON `price_book_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_pbi_category` ON `price_book_items` (`category`);--> statement-breakpoint
CREATE INDEX `idx_pbi_active` ON `price_book_items` (`is_active`);--> statement-breakpoint
CREATE INDEX `idx_pbi_sku` ON `price_book_items` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_rp_role` ON `role_permissions` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_rp_permission` ON `role_permissions` (`permission_id`);--> statement-breakpoint
CREATE INDEX `idx_ss_intake` ON `scope_suggestions` (`intake_form_id`);--> statement-breakpoint
CREATE INDEX `idx_ss_assembly` ON `scope_suggestions` (`assembly_id`);--> statement-breakpoint
CREATE INDEX `idx_ss_status` ON `scope_suggestions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_assemblies_trade` ON `assemblies` (`trade`);--> statement-breakpoint
CREATE INDEX `idx_assemblies_active` ON `assemblies` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_bi_bundle` ON `bundle_items` (`bundleId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `idx_bi_catalog` ON `bundle_items` (`catalogItemId`);--> statement-breakpoint
CREATE INDEX `idx_bundles_preset` ON `bundles` (`isPreset`);--> statement-breakpoint
CREATE INDEX `idx_bundles_active` ON `bundles` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_bundles_created_by` ON `bundles` (`createdBy`);--> statement-breakpoint
CREATE INDEX `idx_ci_group` ON `catalog_items` (`costGroupName`);--> statement-breakpoint
CREATE INDEX `idx_ci_active` ON `catalog_items` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_ci_code` ON `catalog_items` (`costCode`);--> statement-breakpoint
CREATE INDEX `idx_ed_status` ON `estimate_drafts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ed_bundle` ON `estimate_drafts` (`bundleId`);--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_channel` ON `projects` (`channel`);--> statement-breakpoint
CREATE INDEX `idx_projects_client` ON `projects` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_users_role_id` ON `users` (`role_id`);--> statement-breakpoint
CREATE INDEX `idx_users_active` ON `users` (`is_active`);