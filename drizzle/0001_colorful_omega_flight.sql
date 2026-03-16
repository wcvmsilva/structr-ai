CREATE TABLE `assemblies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supabaseId` varchar(64),
	`name` varchar(255) NOT NULL,
	`code` varchar(32) NOT NULL,
	`category` varchar(128),
	`description` text,
	`defaultUnit` varchar(16) DEFAULT 'EA',
	`directCost` decimal(12,2) NOT NULL,
	`sellPrice` decimal(12,2) NOT NULL,
	`crewHours` decimal(8,2) DEFAULT '0',
	`itemCount` int DEFAULT 0,
	`grossProfitPct` decimal(5,2),
	`isActive` boolean NOT NULL DEFAULT true,
	`conditionRules` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assemblies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `building_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`jurisdiction` varchar(128) NOT NULL,
	`category` varchar(128),
	`description` text,
	`requirements` json,
	`effectiveDate` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `building_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bundle_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bundleId` int NOT NULL,
	`assemblyId` int NOT NULL,
	`quantity` decimal(10,2) DEFAULT '1',
	`isOptional` boolean DEFAULT false,
	`sortOrder` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bundle_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bundles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`channel` enum('residential','commercial','insurance') DEFAULT 'residential',
	`defaultDiscount` decimal(5,2) DEFAULT '8.00',
	`minGrossProfit` decimal(5,2) DEFAULT '35.00',
	`isPreset` boolean DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bundles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crew_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`crewId` int NOT NULL,
	`assemblyId` int,
	`startDate` timestamp,
	`endDate` timestamp,
	`status` enum('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crew_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `crews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`specialty` varchar(128),
	`size` int DEFAULT 2,
	`hourlyRate` decimal(8,2),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `crews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intake_questions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`category` varchar(128) NOT NULL,
	`question` text NOT NULL,
	`inputType` enum('text','number','select','multiselect','boolean','file') NOT NULL DEFAULT 'text',
	`options` json,
	`isRequired` boolean DEFAULT false,
	`sortOrder` int DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `intake_questions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `intake_responses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`questionId` int NOT NULL,
	`answer` text,
	`answeredBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `intake_responses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`fileName` varchar(255) NOT NULL,
	`fileUrl` text NOT NULL,
	`fileKey` varchar(512) NOT NULL,
	`fileType` varchar(64),
	`mimeType` varchar(128),
	`sizeBytes` int,
	`uploadedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_files_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`eventType` enum('status_change','estimate_created','estimate_updated','review_action','file_uploaded','note_added','cost_adjustment','bundle_applied') NOT NULL,
	`description` text,
	`previousValue` json,
	`newValue` json,
	`performedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `project_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`clientName` varchar(255),
	`clientEmail` varchar(320),
	`clientPhone` varchar(32),
	`address` text,
	`city` varchar(128) DEFAULT 'Charleston',
	`county` varchar(128),
	`status` enum('intake','estimating','review','approved','in_progress','completed','cancelled') NOT NULL DEFAULT 'intake',
	`channel` enum('residential','commercial','insurance') NOT NULL DEFAULT 'residential',
	`estimatedValue` decimal(12,2),
	`actualCost` decimal(12,2),
	`grossProfit` decimal(5,2),
	`notes` text,
	`metadata` json,
	`createdBy` int,
	`assignedTo` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`reviewerId` int NOT NULL,
	`action` enum('approved','rejected','revision_requested') NOT NULL,
	`comments` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `risk_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`category` varchar(128) NOT NULL,
	`description` text,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`condition` json,
	`mitigation` text,
	`costImpactPct` decimal(5,2),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `risk_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` int,
	`workflowType` varchar(128) NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`input` json,
	`output` json,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`error` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','estimator','reviewer') NOT NULL DEFAULT 'user';