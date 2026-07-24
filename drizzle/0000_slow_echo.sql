CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`endpoint_id` text,
	`endpoint_name_snapshot` text,
	`backend_server_id` text,
	`backend_server_key_snapshot` text,
	`session_id` text,
	`operation_type` text NOT NULL,
	`item_name` text,
	`request_args_json` text,
	`request_args_truncated` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`duration_ms` integer,
	`error_message` text,
	FOREIGN KEY (`endpoint_id`) REFERENCES `client_endpoints`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`backend_server_id`) REFERENCES `backend_servers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_timestamp_idx` ON `audit_log` (`timestamp`);--> statement-breakpoint
CREATE INDEX `audit_log_endpoint_timestamp_idx` ON `audit_log` (`endpoint_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `audit_log_backend_timestamp_idx` ON `audit_log` (`backend_server_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `audit_log_item_name_idx` ON `audit_log` (`item_name`);--> statement-breakpoint
CREATE INDEX `audit_log_status_idx` ON `audit_log` (`status`);--> statement-breakpoint
CREATE TABLE `backend_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`connection_type` text NOT NULL,
	`command` text,
	`args` text,
	`env` text,
	`url` text,
	`headers` text,
	`enabled` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`last_error` text,
	`last_connected_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backend_servers_key_idx` ON `backend_servers` (`key`);--> statement-breakpoint
CREATE TABLE `client_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`default_policy` text DEFAULT 'deny_all' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_endpoints_slug_idx` ON `client_endpoints` (`slug`);--> statement-breakpoint
CREATE TABLE `endpoint_server_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`endpoint_id` text NOT NULL,
	`backend_server_id` text NOT NULL,
	`access` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `client_endpoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backend_server_id`) REFERENCES `backend_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoint_server_rules_unique_idx` ON `endpoint_server_rules` (`endpoint_id`,`backend_server_id`);