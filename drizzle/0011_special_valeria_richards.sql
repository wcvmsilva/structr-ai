ALTER TABLE `bundles` MODIFY COLUMN `channel` enum('direct','insurance','commercial','residential') DEFAULT 'direct';--> statement-breakpoint
ALTER TABLE `clients` MODIFY COLUMN `channel` enum('direct','insurance','commercial','residential') NOT NULL DEFAULT 'direct';--> statement-breakpoint
ALTER TABLE `estimate_drafts` MODIFY COLUMN `channel` enum('direct','insurance','commercial','residential') DEFAULT 'direct';--> statement-breakpoint
ALTER TABLE `estimates` MODIFY COLUMN `channel` enum('direct','insurance','commercial','residential') DEFAULT 'direct';--> statement-breakpoint
ALTER TABLE `intake_forms` MODIFY COLUMN `channel` enum('direct','insurance','commercial','residential') DEFAULT 'direct';--> statement-breakpoint
ALTER TABLE `projects` MODIFY COLUMN `channel` enum('direct','insurance','commercial','residential') NOT NULL DEFAULT 'direct';