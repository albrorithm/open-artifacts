CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`current_revision_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifacts_owner_updated` ON `artifacts` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `review_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`number` integer NOT NULL,
	`anchor_id` text,
	`excerpt` text NOT NULL,
	`section` text NOT NULL,
	`context_fingerprint` text NOT NULL,
	`view_state_json` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_artifact_number` ON `review_threads` (`artifact_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_owner_request` ON `review_threads` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`note` text NOT NULL,
	`object_key` text NOT NULL,
	`content_sha256` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_artifact_number` ON `revisions` (`artifact_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_owner_request` ON `revisions` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `thread_events` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`body` text NOT NULL,
	`revision_id` text,
	`batch_id` text,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `review_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_artifact_created` ON `thread_events` (`artifact_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_owner_request` ON `thread_events` (`owner_id`,`request_id`);