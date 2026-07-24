"use client";

import type { CSSProperties } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  Network,
  Terminal,
  Globe,
  Radio,
  Plug,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  CircleDashed,
  Server as ServerIcon,
  Clock,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PULSE_GLOW_COLOR } from "./status-colors";

const TYPE_ICON = { stdio: Terminal, http: Globe, sse: Radio };
const TYPE_LABEL = { stdio: "Stdio", http: "Streamable HTTP", sse: "SSE" };
const TYPE_ROLE_VAR = { stdio: "--role-stdio", http: "--role-http", sse: "--role-sse" };
const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  connecting: "Connecting",
  error: "Error",
  disconnected: "Disconnected",
};

type PulseStatus = "idle" | "active" | "success" | "error" | "denied";

function absoluteTime(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy 'at' h:mm a");
}

function usePulseStyle(pulseStatus: PulseStatus | undefined) {
  const status = pulseStatus ?? "idle";
  const glowing = status !== "idle";
  const color = PULSE_GLOW_COLOR[status];
  return {
    // overflow-hidden is only needed to clip the radial-gradient overlay below while it's actually
    // rendered (status === "active"); keeping it off otherwise avoids silently clipping node content
    // that runs slightly taller than the fixed height React Flow nodes are given (see NODE_DIMENSIONS
    // in gateway-flow.tsx) — a display quirk is preferable to invisible/cut-off information.
    wrapperClassName: cn("relative transition-shadow duration-300", status === "active" && "overflow-hidden", glowing && "ring-2"),
    wrapperStyle: glowing
      ? ({
          boxShadow: `0 0 0 1px ${color}, 0 0 28px -4px ${color}`,
          ["--tw-ring-color" as string]: color,
        } as CSSProperties)
      : undefined,
    overlay: status === "active" && (
      <div
        className="pointer-events-none absolute inset-0 animate-pulse"
        style={{ background: `radial-gradient(circle at 30% 20%, ${color}22, transparent 70%)` }}
      />
    ),
  };
}

function RoleStripe({ colorVar }: { colorVar: string }) {
  return (
    <div
      className="absolute inset-y-0 left-0 w-1 rounded-l-lg"
      style={{ backgroundColor: `var(${colorVar})` }}
    />
  );
}

function RoleAvatar({ colorVar, children }: { colorVar: string; children: React.ReactNode }) {
  return (
    <div
      className="flex size-8 shrink-0 items-center justify-center rounded-md"
      style={{ backgroundColor: `color-mix(in oklch, var(${colorVar}) 18%, transparent)`, color: `var(${colorVar})` }}
    >
      {children}
    </div>
  );
}

const STATUS_BADGE: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  connected: { icon: CheckCircle2, className: "text-emerald-500 bg-emerald-500/15" },
  connecting: { icon: Loader2, className: "text-amber-500 bg-amber-500/15 [&_svg]:animate-spin" },
  error: { icon: XCircle, className: "text-red-500 bg-red-500/15" },
  disconnected: { icon: CircleDashed, className: "text-muted-foreground bg-muted" },
};

function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_BADGE[status] ?? STATUS_BADGE.disconnected;
  const Icon = entry.icon;
  return (
    <div
      className={cn(
        "absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full ring-2 ring-card",
        entry.className
      )}
    >
      <Icon className="size-3" />
    </div>
  );
}

function DetailRow({ icon: Icon, mono, children }: { icon: typeof Clock; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground/80">
      <Icon className="mt-0.5 size-2.5 shrink-0" />
      <span className={cn("min-w-0 break-words", mono && "font-mono")}>{children}</span>
    </div>
  );
}

const CARD_WIDTH = "w-80";

export type ServerNodeData = {
  name: string;
  description: string | null;
  connectionType: "stdio" | "http" | "sse";
  enabled: boolean;
  status: string;
  target: string;
  host: string | null;
  pid: number | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  pulseStatus?: PulseStatus;
};

export function ServerNode({ data }: NodeProps<Node<ServerNodeData>>) {
  const Icon = TYPE_ICON[data.connectionType] ?? Terminal;
  const roleVar = TYPE_ROLE_VAR[data.connectionType];
  const { wrapperClassName, wrapperStyle, overlay } = usePulseStyle(data.pulseStatus);

  return (
    <div
      className={cn(
        "flex h-full items-start gap-2.5 rounded-lg border bg-card py-3 pl-4 pr-3 shadow-sm",
        CARD_WIDTH,
        wrapperClassName
      )}
      style={wrapperStyle}
      title={data.description ?? undefined}
    >
      {overlay}
      <RoleStripe colorVar={roleVar} />
      <div className="relative shrink-0">
        <RoleAvatar colorVar={roleVar}>
          <Icon className="size-4" />
        </RoleAvatar>
        <StatusBadge status={data.status} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{data.name}</p>
        <p className="break-words text-xs text-muted-foreground">
          {data.enabled ? "Enabled" : "Disabled"} · {STATUS_LABEL[data.status] ?? data.status} ·{" "}
          {TYPE_LABEL[data.connectionType]}
        </p>

        <DetailRow icon={data.connectionType === "stdio" ? Terminal : Globe} mono>
          {data.target}
        </DetailRow>

        {data.host && <DetailRow icon={Globe}>Host: {data.host}</DetailRow>}
        {data.pid !== null && <DetailRow icon={ServerIcon}>PID {data.pid}</DetailRow>}

        {data.status === "error" && data.lastError && (
          <div className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-red-500">
            <AlertTriangle className="mt-0.5 size-2.5 shrink-0" />
            <span className="min-w-0 break-words">{data.lastError}</span>
          </div>
        )}

        {data.lastConnectedAt ? (
          <>
            <DetailRow icon={Clock}>
              Connected {formatDistanceToNowStrict(new Date(data.lastConnectedAt), { addSuffix: true })}
            </DetailRow>
            <DetailRow icon={Clock}>{absoluteTime(data.lastConnectedAt)}</DetailRow>
          </>
        ) : (
          <DetailRow icon={Clock}>Never connected</DetailRow>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="right" className="!bg-primary" />
    </div>
  );
}

export type GatewayNodeData = { serverCount: number; endpointCount: number; pulseStatus?: PulseStatus };

export function GatewayNode({ data }: NodeProps<Node<GatewayNodeData>>) {
  const { wrapperClassName, wrapperStyle, overlay } = usePulseStyle(data.pulseStatus);

  return (
    <div
      className={cn(
        "relative flex h-full w-52 flex-col items-center justify-center gap-1.5 rounded-xl border-2 bg-card px-4 py-4 shadow-md",
        wrapperClassName
      )}
      style={{ borderColor: "var(--role-gateway)", ...wrapperStyle }}
    >
      {overlay}
      <Handle type="target" position={Position.Left} id="left" className="!bg-primary" />
      <div
        className="flex size-10 items-center justify-center rounded-full"
        style={{
          backgroundColor: "color-mix(in oklch, var(--role-gateway) 18%, transparent)",
          color: "var(--role-gateway)",
        }}
      >
        <Network className="size-5" />
      </div>
      <p className="text-sm font-semibold">Gateway</p>
      <p className="text-center text-xs text-muted-foreground">
        {data.serverCount} server{data.serverCount === 1 ? "" : "s"} · {data.endpointCount} endpoint
        {data.endpointCount === 1 ? "" : "s"}
      </p>
      <Handle type="source" position={Position.Right} id="right" className="!bg-primary" />
    </div>
  );
}

export type EndpointNodeData = {
  name: string;
  slug: string;
  enabled: boolean;
  defaultPolicy: "allow_all" | "deny_all";
  lastUsedAt: string | null;
  createdAt: string;
  activeSessions: number;
  pulseStatus?: PulseStatus;
};

function endpointStatus(data: EndpointNodeData): string {
  if (!data.enabled) return "disconnected";
  return data.activeSessions > 0 ? "connected" : "disconnected";
}

export function EndpointNode({ data }: NodeProps<Node<EndpointNodeData>>) {
  const { wrapperClassName, wrapperStyle, overlay } = usePulseStyle(data.pulseStatus);
  const status = endpointStatus(data);

  return (
    <div
      className={cn(
        "flex h-full items-start gap-2.5 rounded-lg border bg-card py-3 pl-4 pr-3 shadow-sm",
        CARD_WIDTH,
        wrapperClassName
      )}
      style={wrapperStyle}
    >
      {overlay}
      <RoleStripe colorVar="--role-endpoint" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-primary" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-primary" />
      <div className="relative shrink-0">
        <RoleAvatar colorVar="--role-endpoint">
          <Plug className="size-4" />
        </RoleAvatar>
        <StatusBadge status={status} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">{data.name}</p>
        <p className="break-words text-xs text-muted-foreground">
          {data.enabled ? "Enabled" : "Disabled"} ·{" "}
          {data.defaultPolicy === "allow_all" ? "allow by default" : "deny by default"}
        </p>

        <DetailRow icon={Globe} mono>
          /api/mcp/{data.slug}
        </DetailRow>

        {data.lastUsedAt ? (
          <>
            <DetailRow icon={Clock}>
              Used {formatDistanceToNowStrict(new Date(data.lastUsedAt), { addSuffix: true })}
            </DetailRow>
            <DetailRow icon={Clock}>{absoluteTime(data.lastUsedAt)}</DetailRow>
          </>
        ) : (
          <DetailRow icon={Clock}>Never used</DetailRow>
        )}
        <DetailRow icon={Clock}>Created {absoluteTime(data.createdAt)}</DetailRow>
      </div>
    </div>
  );
}

export type ClientNodeData = {
  clientId: string;
  label: string | null;
  lastSeenAt: string;
  pulseStatus?: PulseStatus;
};

export function ClientNode({ data }: NodeProps<Node<ClientNodeData>>) {
  const { wrapperClassName, wrapperStyle, overlay } = usePulseStyle(data.pulseStatus);

  return (
    <div
      className={cn(
        "flex h-full w-56 items-start gap-2 rounded-lg border bg-card py-2 pl-3 pr-2.5 shadow-sm",
        wrapperClassName
      )}
      style={wrapperStyle}
    >
      {overlay}
      <RoleStripe colorVar="--role-endpoint" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-primary" />
      <div className="relative shrink-0">
        <RoleAvatar colorVar="--role-endpoint">
          <User className="size-3.5" />
        </RoleAvatar>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{data.label ?? data.clientId}</p>
        <DetailRow icon={Clock}>
          {formatDistanceToNowStrict(new Date(data.lastSeenAt), { addSuffix: true })}
        </DetailRow>
      </div>
    </div>
  );
}
