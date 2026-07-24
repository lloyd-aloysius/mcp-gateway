CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `backend_server_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`backend_server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`backend_server_id`) REFERENCES `backend_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backend_server_tools_unique_idx` ON `backend_server_tools` (`backend_server_id`,`tool_name`);--> statement-breakpoint
CREATE TABLE `endpoint_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`client_id` text NOT NULL,
	`label` text,
	`first_seen_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `client_endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoint_clients_unique_idx` ON `endpoint_clients` (`endpoint_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `audit_log` ADD `client_id` text;