import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

export const backendServers = sqliteTable("backend_servers", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  connectionType: text("connection_type", {
    enum: ["stdio", "http", "sse"],
  }).notNull(),
  command: text("command"),
  args: text("args", { mode: "json" }).$type<string[]>(),
  env: text("env", { mode: "json" }).$type<Record<string, string>>(),
  url: text("url"),
  headers: text("headers", { mode: "json" }).$type<Record<string, string>>(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  status: text("status", {
    enum: ["connected", "connecting", "disconnected", "error"],
  })
    .notNull()
    .default("disconnected"),
  lastError: text("last_error"),
  lastConnectedAt: integer("last_connected_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (table) => [
  uniqueIndex("backend_servers_key_idx").on(table.key),
]);

export const clientEndpoints = sqliteTable("client_endpoints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  tokenHash: text("token_hash").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  defaultPolicy: text("default_policy", {
    enum: ["allow_all", "deny_all"],
  })
    .notNull()
    .default("deny_all"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
}, (table) => [
  uniqueIndex("client_endpoints_slug_idx").on(table.slug),
]);

export const backendServerTools = sqliteTable("backend_server_tools", {
  id: text("id").primaryKey(),
  backendServerId: text("backend_server_id")
    .notNull()
    .references(() => backendServers.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (table) => [
  uniqueIndex("backend_server_tools_unique_idx").on(table.backendServerId, table.toolName),
]);

export const endpointClients = sqliteTable("endpoint_clients", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id")
    .notNull()
    .references(() => clientEndpoints.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  label: text("label"),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (table) => [
  uniqueIndex("endpoint_clients_unique_idx").on(table.endpointId, table.clientId),
]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export const endpointServerRules = sqliteTable("endpoint_server_rules", {
  id: text("id").primaryKey(),
  endpointId: text("endpoint_id")
    .notNull()
    .references(() => clientEndpoints.id, { onDelete: "cascade" }),
  backendServerId: text("backend_server_id")
    .notNull()
    .references(() => backendServers.id, { onDelete: "cascade" }),
  access: text("access", { enum: ["allow", "deny"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
}, (table) => [
  uniqueIndex("endpoint_server_rules_unique_idx").on(
    table.endpointId,
    table.backendServerId
  ),
]);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
  endpointId: text("endpoint_id").references(() => clientEndpoints.id, {
    onDelete: "set null",
  }),
  endpointNameSnapshot: text("endpoint_name_snapshot"),
  backendServerId: text("backend_server_id").references(
    () => backendServers.id,
    { onDelete: "set null" }
  ),
  backendServerKeySnapshot: text("backend_server_key_snapshot"),
  sessionId: text("session_id"),
  clientId: text("client_id"),
  operationType: text("operation_type", {
    enum: [
      "tools/list",
      "tools/call",
      "resources/list",
      "resources/read",
      "prompts/list",
      "prompts/get",
      "connect",
      "disconnect",
    ],
  }).notNull(),
  itemName: text("item_name"),
  requestArgsJson: text("request_args_json"),
  requestArgsTruncated: integer("request_args_truncated", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  status: text("status", { enum: ["success", "error", "denied"] }).notNull(),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
}, (table) => [
  index("audit_log_timestamp_idx").on(table.timestamp),
  index("audit_log_endpoint_timestamp_idx").on(
    table.endpointId,
    table.timestamp
  ),
  index("audit_log_backend_timestamp_idx").on(
    table.backendServerId,
    table.timestamp
  ),
  index("audit_log_item_name_idx").on(table.itemName),
  index("audit_log_status_idx").on(table.status),
]);

export type BackendServer = typeof backendServers.$inferSelect;
export type NewBackendServer = typeof backendServers.$inferInsert;
export type ClientEndpoint = typeof clientEndpoints.$inferSelect;
export type NewClientEndpoint = typeof clientEndpoints.$inferInsert;
export type EndpointServerRule = typeof endpointServerRules.$inferSelect;
export type NewEndpointServerRule = typeof endpointServerRules.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type BackendServerTool = typeof backendServerTools.$inferSelect;
export type NewBackendServerTool = typeof backendServerTools.$inferInsert;
export type EndpointClient = typeof endpointClients.$inferSelect;
export type NewEndpointClient = typeof endpointClients.$inferInsert;
