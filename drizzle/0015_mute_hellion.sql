ALTER TABLE `projects` ADD `latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `projects` ADD `longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `projects` ADD `geocode_confidence` enum('high','medium','low','failed','pending') DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `projects` ADD `geocode_source` varchar(32);--> statement-breakpoint
ALTER TABLE `projects` ADD `geocoded_address` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `geocoded_at` timestamp;--> statement-breakpoint
CREATE INDEX `idx_projects_geocode_confidence` ON `projects` (`geocode_confidence`);