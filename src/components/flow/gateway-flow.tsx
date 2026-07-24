"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Panel,
  Position,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { ServerNode, GatewayNode, EndpointNode, ClientNode } from "./nodes";
import { PulseEdge } from "./pulse-edge";
import { FlowControls } from "./flow-controls";

const nodeTypes = { server: ServerNode, gateway: GatewayNode, endpoint: EndpointNode, client: ClientNode };
const edgeTypes = { pulse: PulseEdge };

const ROW_HEIGHT = 260;
const TOP_MARGIN = 24;

// Explicit width/height AND `measured` on each node (matching each node component's actual
// Tailwind width, plus a generous height buffer over the tallest realistic content) so React Flow
// treats them as already measured and skips its ResizeObserver-based auto-measurement entirely.
// Both fields are needed: top-level width/height gates the initial hidden-until-measured CSS
// state, while `measured` is what fitView's own bounds computation reads to decide whether a node
// is "visible" and should be included in the fit — omitting either one leaves that respective
// consumer waiting on the real ResizeObserver pass, which some browsers (observed in Safari) never
// fire for these nodes at all.
const NODE_DIMENSIONS = {
  gateway: { width: 208, height: 130 },
  server: { width: 320, height: 200 },
  endpoint: { width: 320, height: 170 },
  client: { width: 224, height: 90 },
} as const;

const SERVER_X = 0;
const GATEWAY_X = 560;
// Same horizontal gap on both sides of the hub: server-column-right-edge to gateway-left-edge
// equals gateway-right-edge to endpoint-left-edge.
const HUB_GAP = GATEWAY_X - SERVER_X - NODE_DIMENSIONS.server.width;
const ENDPOINT_X = GATEWAY_X + NODE_DIMENSIONS.gateway.width + HUB_GAP;
// Separate, smaller gap for the client fan-out — this one was already correct as-is.
export const CLIENT_X = ENDPOINT_X + NODE_DIMENSIONS.endpoint.width + 80;
const CLIENT_ROW_HEIGHT = 80;

// Edge source/target coordinates are computed from each node's *handle* bounds, which React Flow
// normally measures separately (via the same ResizeObserver pass that measures node size). Giving
// nodes an explicit width/height (above) skips the node-size half of that measurement, but not the
// handle-bounds half — so edges still silently failed to render in the same Safari environment
// where that observer never fires. React Flow falls back to a node's explicit `handles` array
// instead of measuring when present, so we describe them directly: every handle in this app sits
// dead-center-left or dead-center-right of its node (nothing uses Top/Bottom), so the geometry is
// simple regardless of node type.
function makeHandle(
  id: string,
  type: "source" | "target",
  position: typeof Position.Left | typeof Position.Right,
  nodeWidth: number,
  nodeHeight: number
) {
  return {
    id,
    type,
    position,
    x: position === Position.Left ? 0 : nodeWidth - 1,
    y: nodeHeight / 2 - 0.5,
    width: 1,
    height: 1,
  };
}

const NODE_HANDLES = {
  gateway: [
    makeHandle("left", "target", Position.Left, NODE_DIMENSIONS.gateway.width, NODE_DIMENSIONS.gateway.height),
    makeHandle("right", "source", Position.Right, NODE_DIMENSIONS.gateway.width, NODE_DIMENSIONS.gateway.height),
  ],
  server: [
    makeHandle("right", "source", Position.Right, NODE_DIMENSIONS.server.width, NODE_DIMENSIONS.server.height),
  ],
  endpoint: [
    makeHandle("left", "target", Position.Left, NODE_DIMENSIONS.endpoint.width, NODE_DIMENSIONS.endpoint.height),
    makeHandle("right", "target", Position.Right, NODE_DIMENSIONS.endpoint.width, NODE_DIMENSIONS.endpoint.height),
  ],
  client: [
    makeHandle("left", "source", Position.Left, NODE_DIMENSIONS.client.width, NODE_DIMENSIONS.client.height),
  ],
};

type BackendServerRow = {
  id: string;
  name: string;
  description: string | null;
  connectionType: "stdio" | "http" | "sse";
  command: string | null;
  args: string[] | null;
  url: string | null;
  enabled: boolean;
  status: string;
  lastConnectedAt: string | null;
  lastError: string | null;
  pid: number | null;
};

type EndpointRow = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  defaultPolicy: "allow_all" | "deny_all";
  lastUsedAt: string | null;
  createdAt: string;
  activeSessions: number;
};

type EndpointClientRow = {
  endpointId: string;
  clientId: string;
  label: string | null;
  lastSeenAt: string;
};

export type PulseState = Record<string, { status: "idle" | "active" | "success" | "error" | "denied"; label?: string }>;

// The `fitView` prop on <ReactFlow> only fits once, at mount. servers/endpoints/clients are each
// polled independently and can resolve at different times (e.g. a client created from the
// endpoints page while already viewing this one), so the node set can change shape after mount.
// Without this, the viewport stays fit to whatever topology existed at first paint, leaving
// later-arriving nodes rendered outside the visible pan/zoom window.
//
// Every node here is given explicit `measured`/`handles` (see NODE_DIMENSIONS/NODE_HANDLES above),
// so fitView's own bounds computation never depends on React Flow's ResizeObserver-driven
// measurement — deliberately NOT gated on `useNodesInitialized()`, which reads a different internal
// flag (`internals.handleBounds`, populated only by that same observer) and can stay false
// indefinitely in browsers where it never fires, permanently blocking any re-fit.
//
// Re-fit only when the actual *set* of node ids changes (a node was added/removed), not on every
// background poll — servers/endpoints/clients are polled every 8-10s and each poll produces new
// object references even when nothing meaningfully changed. Naively re-fitting on every poll would
// reset any zoom/pan the user just did every ~10 seconds; tracking the last-fit signature keeps the
// fit reactive to real topology changes only.
//
// The visible "zoom flash" on load isn't actually about animation duration — it's that this runs
// inside a useEffect, which only fires *after* the browser has already painted at least one frame
// of React Flow's default, unfit viewport (zoom 1, origin 0,0). No duration setting can prevent
// that first frame from being visible; only hiding the canvas until the fit is confirmed applied
// can (see the `ready`/`onFirstFit` handling in GatewayFlow below).
function AutoFitView({ nodeIdsSignature, onFirstFit }: { nodeIdsSignature: string; onFirstFit: () => void }) {
  const { fitView } = useReactFlow();
  const lastFitSignature = useRef<string | null>(null);

  useEffect(() => {
    if (lastFitSignature.current === nodeIdsSignature) return;
    const isFirstFit = lastFitSignature.current === null;
    lastFitSignature.current = nodeIdsSignature;
    void fitView({ padding: 0.3, duration: isFirstFit ? 0 : 200 }).then(() => {
      if (isFirstFit) onFirstFit();
    });
  }, [nodeIdsSignature, fitView, onFirstFit]);

  return null;
}

function serverTarget(s: BackendServerRow): string {
  if (s.connectionType === "stdio") return `${s.command ?? ""} ${(s.args ?? []).join(" ")}`.trim();
  return s.url ?? "";
}

function serverHost(s: BackendServerRow): string | null {
  if (s.connectionType === "stdio" || !s.url) return null;
  try {
    const u = new URL(s.url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return null;
  }
}

export function GatewayFlow({
  servers,
  endpoints,
  clients = [],
  pulses,
}: {
  servers: BackendServerRow[];
  endpoints: EndpointRow[];
  clients?: EndpointClientRow[];
  pulses: PulseState;
}) {
  const { nodes, edges } = useMemo(() => {
    const rowCount = Math.max(servers.length, endpoints.length, 1);
    const gatewayY = TOP_MARGIN + ((rowCount - 1) * ROW_HEIGHT) / 2;

    const anyActive = Object.values(pulses).some((p) => p.status === "active");
    const anyFlash = Object.values(pulses).find((p) => p.status !== "idle" && p.status !== "active");
    const gatewayPulse = anyActive ? "active" : anyFlash?.status ?? "idle";

    const nodes: Node[] = [
      {
        id: "gateway",
        type: "gateway",
        position: { x: GATEWAY_X, y: gatewayY },
        data: { serverCount: servers.length, endpointCount: endpoints.length, pulseStatus: gatewayPulse },
        draggable: false,
        ...NODE_DIMENSIONS.gateway,
        measured: NODE_DIMENSIONS.gateway,
        handles: NODE_HANDLES.gateway,
      },
      ...servers.map((s, i) => ({
        id: `server-${s.id}`,
        type: "server",
        position: { x: SERVER_X, y: TOP_MARGIN + i * ROW_HEIGHT },
        data: {
          name: s.name,
          description: s.description,
          connectionType: s.connectionType,
          enabled: s.enabled,
          status: s.status,
          target: serverTarget(s),
          host: serverHost(s),
          pid: s.pid,
          lastConnectedAt: s.lastConnectedAt,
          lastError: s.lastError,
          pulseStatus: pulses[`server-${s.id}`]?.status ?? "idle",
        },
        draggable: false,
        sourcePosition: Position.Right,
        ...NODE_DIMENSIONS.server,
        measured: NODE_DIMENSIONS.server,
        handles: NODE_HANDLES.server,
      })),
      ...endpoints.map((e, i) => ({
        id: `endpoint-${e.id}`,
        type: "endpoint",
        position: { x: ENDPOINT_X, y: TOP_MARGIN + i * ROW_HEIGHT },
        data: {
          name: e.name,
          slug: e.slug,
          enabled: e.enabled,
          defaultPolicy: e.defaultPolicy,
          lastUsedAt: e.lastUsedAt,
          createdAt: e.createdAt,
          activeSessions: e.activeSessions,
          pulseStatus: pulses[`endpoint-${e.id}`]?.status ?? "idle",
        },
        draggable: false,
        targetPosition: Position.Left,
        ...NODE_DIMENSIONS.endpoint,
        measured: NODE_DIMENSIONS.endpoint,
        handles: NODE_HANDLES.endpoint,
      })),
    ];

    const edges: Edge[] = [
      ...servers.map((s) => {
        const pulse = pulses[`server-${s.id}`];
        return {
          id: `edge-server-${s.id}`,
          source: `server-${s.id}`,
          sourceHandle: "right",
          target: "gateway",
          targetHandle: "left",
          type: "pulse",
          data: { pulseStatus: pulse?.status ?? "idle", label: pulse?.label },
        };
      }),
      ...endpoints.map((e) => {
        const pulse = pulses[`endpoint-${e.id}`];
        return {
          id: `edge-endpoint-${e.id}`,
          source: "gateway",
          sourceHandle: "right",
          target: `endpoint-${e.id}`,
          targetHandle: "left",
          type: "pulse",
          data: { pulseStatus: pulse?.status ?? "idle", label: pulse?.label },
        };
      }),
    ];

    for (const e of endpoints) {
      const endpointClients = clients.filter((c) => c.endpointId === e.id);
      if (endpointClients.length === 0) continue;
      const endpointY = TOP_MARGIN + endpoints.indexOf(e) * ROW_HEIGHT;
      const fanStartY =
        endpointY - ((endpointClients.length - 1) * CLIENT_ROW_HEIGHT) / 2 + 24;

      endpointClients.forEach((c, ci) => {
        const nodeId = `client-${e.id}-${c.clientId}`;
        const pulseKey = `client-${e.id}-${c.clientId}`;
        const pulse = pulses[pulseKey];
        nodes.push({
          id: nodeId,
          type: "client",
          position: { x: CLIENT_X, y: fanStartY + ci * CLIENT_ROW_HEIGHT },
          data: {
            clientId: c.clientId,
            label: c.label,
            lastSeenAt: c.lastSeenAt,
            pulseStatus: pulse?.status ?? "idle",
          },
          draggable: false,
          sourcePosition: Position.Left,
          ...NODE_DIMENSIONS.client,
          measured: NODE_DIMENSIONS.client,
          handles: NODE_HANDLES.client,
        });
        edges.push({
          id: `edge-${nodeId}`,
          source: nodeId,
          sourceHandle: "left",
          target: `endpoint-${e.id}`,
          targetHandle: "right",
          type: "pulse",
          data: { pulseStatus: pulse?.status ?? "idle", label: pulse?.label },
        });
      });
    }

    return { nodes, edges };
  }, [servers, endpoints, clients, pulses]);

  const nodeIdsSignature = useMemo(() => nodes.map((n) => n.id).sort().join(","), [nodes]);

  // Hidden until the very first fit is confirmed applied, then revealed — see AutoFitView's
  // comment for why this is necessary (a useEffect-driven fit can't prevent the browser from
  // painting React Flow's default unfit viewport for a frame or more beforehand). A safety
  // timeout reveals it regardless after a short delay in case fitView never resolves for some
  // reason, so the canvas can never get stuck invisible.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={cn("h-full w-full", ready ? "opacity-100" : "opacity-0")}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <AutoFitView nodeIdsSignature={nodeIdsSignature} onFirstFit={() => setReady(true)} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--flow-dot)" />
        <Panel position="bottom-right">
          <FlowControls />
        </Panel>
      </ReactFlow>
    </div>
  );
}
