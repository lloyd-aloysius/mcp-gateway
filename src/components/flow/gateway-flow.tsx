"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Panel,
  Position,
  useReactFlow,
  useStore,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { ServerNode, GatewayNode, EndpointNode, ClientNode } from "./nodes";
import { PulseEdge } from "./pulse-edge";
import { FLOW_PADDING, FlowControls } from "./flow-controls";

const nodeTypes = { server: ServerNode, gateway: GatewayNode, endpoint: EndpointNode, client: ClientNode };
const edgeTypes = { pulse: PulseEdge };

const ROW_HEIGHT = 260;

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
  client: { width: 224, height: 64 },
} as const;

const SERVER_X = 0;
const OUTER_SERVER_X = SERVER_X - NODE_DIMENSIONS.server.width - 64;
const OUTER_EDGE_LEAD = SERVER_X + NODE_DIMENSIONS.server.width + 16;
const GATEWAY_X = 560;
// Same horizontal gap on both sides of the hub: server-column-right-edge to gateway-left-edge
// equals gateway-right-edge to endpoint-left-edge.
const HUB_GAP = GATEWAY_X - SERVER_X - NODE_DIMENSIONS.server.width;
const ENDPOINT_X = GATEWAY_X + NODE_DIMENSIONS.gateway.width + HUB_GAP;
// Separate, smaller gap for the client fan-out — this one was already correct as-is.
export const CLIENT_X = ENDPOINT_X + NODE_DIMENSIONS.endpoint.width + 80;
const CLIENT_ROW_HEIGHT = 88;
const ENDPOINT_GROUP_GAP = ROW_HEIGHT - NODE_DIMENSIONS.endpoint.height;

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

type NodeSizes = Record<keyof typeof NODE_DIMENSIONS, { width: number; height: number }>;
const VIEWER_NODE_DIMENSIONS: NodeSizes = { ...NODE_DIMENSIONS, server: { width: 320, height: 112 }, endpoint: { width: 320, height: 96 } };
function nodeHandles(dimensions: NodeSizes) { return {
  gateway: [
    makeHandle("left", "target", Position.Left, dimensions.gateway.width, dimensions.gateway.height),
    makeHandle("right", "source", Position.Right, dimensions.gateway.width, dimensions.gateway.height),
  ],
  server: [
    makeHandle("right", "source", Position.Right, dimensions.server.width, dimensions.server.height),
  ],
  endpoint: [
    makeHandle("left", "target", Position.Left, dimensions.endpoint.width, dimensions.endpoint.height),
    makeHandle("right", "target", Position.Right, dimensions.endpoint.width, dimensions.endpoint.height),
  ],
  client: [
    makeHandle("left", "source", Position.Left, dimensions.client.width, dimensions.client.height),
  ],
}; }

type BackendServerRow = {
  id: string;
  name: string;
  description?: string | null;
  connectionType: "stdio" | "http" | "sse";
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  enabled: boolean;
  status: string;
  lastConnectedAt: string | null;
  lastError?: string | null;
  pid?: number | null;
};

type EndpointRow = {
  id: string;
  name: string;
  slug?: string;
  enabled: boolean;
  defaultPolicy?: "allow_all" | "deny_all";
  lastUsedAt: string | null;
  createdAt?: string;
  activeSessions: number;
};

type EndpointClientRow = {
  endpointId: string;
  clientId: string;
  label: string | null;
  icon?: string;
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
// Re-fit only when the node set or its coordinates change, not on every
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
function AutoFitView({ nodeIdsSignature, onFirstFit, fitOnResize = false }: { nodeIdsSignature: string; onFirstFit: () => void; fitOnResize?: boolean }) {
  const viewportSize = useStore((state) => `${state.width}:${state.height}`);
  const signature = fitOnResize ? `${nodeIdsSignature}:${viewportSize}` : nodeIdsSignature;
  const { fitView } = useReactFlow();
  const lastFitSignature = useRef<string | null>(null);

  useEffect(() => {
    if (lastFitSignature.current === signature) return;
    const isFirstFit = lastFitSignature.current === null;
    lastFitSignature.current = signature;
    void fitView({ padding: FLOW_PADDING, duration: isFirstFit ? 0 : 200 }).then(() => {
      if (isFirstFit) onFirstFit();
    });
  }, [signature, fitView, onFirstFit]);

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
  visualizationOnly = false,
}: {
  servers: BackendServerRow[];
  endpoints: EndpointRow[];
  clients?: EndpointClientRow[];
  pulses: PulseState;
  visualizationOnly?: boolean;
}) {
  const dimensions = visualizationOnly ? VIEWER_NODE_DIMENSIONS : NODE_DIMENSIONS;
  const handles = useMemo(() => nodeHandles(dimensions), [dimensions]);
  const rowHeight = visualizationOnly ? 164 : ROW_HEIGHT;
  const groupGap = visualizationOnly ? 56 : ENDPOINT_GROUP_GAP;
  const { nodes, edges } = useMemo(() => {
    const orderedServers = [...servers].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const staggered = orderedServers.length >= 5;
    const serverStep = staggered ? rowHeight / 2 : rowHeight;
    const serverTop = -((orderedServers.length - 1) * serverStep + dimensions.server.height) / 2;

    const clientsByEndpoint = new Map<string, EndpointClientRow[]>();
    for (const client of clients) {
      const group = clientsByEndpoint.get(client.endpointId) ?? [];
      group.push(client);
      clientsByEndpoint.set(client.endpointId, group);
    }
    const endpointGroups = endpoints.map((endpoint) => {
      const clients = clientsByEndpoint.get(endpoint.id) ?? [];
      const clientHeight = clients.length > 0
        ? (clients.length - 1) * CLIENT_ROW_HEIGHT + dimensions.client.height
        : 0;
      return { endpoint, clients, clientHeight, height: Math.max(dimensions.endpoint.height, clientHeight) };
    });
    const endpointHeight = endpointGroups.reduce((sum, group) => sum + group.height, 0)
      + Math.max(0, endpointGroups.length - 1) * groupGap;
    let groupTop = -endpointHeight / 2;
    const placedEndpoints = [];
    for (const group of endpointGroups) {
      placedEndpoints.push({ ...group, center: groupTop + group.height / 2 });
      groupTop += group.height + groupGap;
    }

    const anyActive = Object.values(pulses).some((p) => p.status === "active");
    const anyFlash = Object.values(pulses).find((p) => p.status !== "idle" && p.status !== "active");
    const gatewayPulse = anyActive ? "active" : anyFlash?.status ?? "idle";

    const nodes: Node[] = [
      {
        id: "gateway",
        type: "gateway",
        position: { x: GATEWAY_X, y: -dimensions.gateway.height / 2 },
        data: { serverCount: servers.length, endpointCount: endpoints.length, pulseStatus: gatewayPulse },
        draggable: false,
        ...dimensions.gateway,
        measured: dimensions.gateway,
        handles: handles.gateway,
      },
      ...orderedServers.map((s, i) => ({
        id: `server-${s.id}`,
        type: "server",
        position: { x: staggered && i % 2 === 1 ? OUTER_SERVER_X : SERVER_X, y: serverTop + i * serverStep },
        data: {
          visualizationOnly,
          name: s.name,
          description: s.description ?? null,
          connectionType: s.connectionType,
          enabled: s.enabled,
          status: s.status,
          target: serverTarget(s),
          host: serverHost(s),
          pid: s.pid ?? null,
          lastConnectedAt: s.lastConnectedAt,
          lastError: s.lastError ?? null,
          pulseStatus: pulses[`server-${s.id}`]?.status ?? "idle",
        },
        draggable: false,
        sourcePosition: Position.Right,
        ...dimensions.server,
        measured: dimensions.server,
        handles: handles.server,
      })),
      ...placedEndpoints.map(({ endpoint: e, center }) => ({
        id: `endpoint-${e.id}`,
        type: "endpoint",
        position: { x: ENDPOINT_X, y: center - dimensions.endpoint.height / 2 },
        data: {
          visualizationOnly,
          name: e.name,
          slug: e.slug ?? "",
          enabled: e.enabled,
          defaultPolicy: e.defaultPolicy ?? "deny_all",
          lastUsedAt: e.lastUsedAt,
          createdAt: e.createdAt ?? "",
          activeSessions: e.activeSessions,
          pulseStatus: pulses[`endpoint-${e.id}`]?.status ?? "idle",
        },
        draggable: false,
        targetPosition: Position.Left,
        ...dimensions.endpoint,
        measured: dimensions.endpoint,
        handles: handles.endpoint,
      })),
    ];

    const edges: Edge[] = [
      ...orderedServers.map((s, i) => {
        const pulse = pulses[`server-${s.id}`];
        return {
          id: `edge-server-${s.id}`,
          source: `server-${s.id}`,
          sourceHandle: "right",
          target: "gateway",
          targetHandle: "left",
          type: "pulse",
          data: {
            pulseStatus: pulse?.status ?? "idle",
            label: pulse?.label,
            leadX: staggered && i % 2 === 1 ? OUTER_EDGE_LEAD : undefined,
            reverseTravel: true,
          },
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
          // The curve is drawn outward from the hub. Requests travel toward it.
          data: { pulseStatus: pulse?.status ?? "idle", label: pulse?.label, reverseTravel: true },
        };
      }),
    ];

    for (const { endpoint: e, clients: endpointClients, clientHeight, center } of placedEndpoints) {
      const fanStartY = center - clientHeight / 2;

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
            icon: c.icon,
            lastSeenAt: c.lastSeenAt,
            pulseStatus: pulse?.status ?? "idle",
          },
          draggable: false,
          sourcePosition: Position.Left,
          ...dimensions.client,
          measured: dimensions.client,
          handles: handles.client,
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
  }, [servers, endpoints, clients, pulses, visualizationOnly, dimensions, handles, rowHeight, groupGap]);

  const nodeIdsSignature = useMemo(() => JSON.stringify(
    nodes.map(({ id, position: { x, y } }) => ({ id, x, y })).sort((a, b) => a.id.localeCompare(b.id))
  ), [nodes]);

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
        fitViewOptions={{ padding: FLOW_PADDING }}
        minZoom={visualizationOnly ? 0.1 : 0.15}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <AutoFitView nodeIdsSignature={nodeIdsSignature} onFirstFit={() => setReady(true)} fitOnResize={visualizationOnly} />
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--flow-dot)" />
        <Panel position="bottom-right">
          <FlowControls />
        </Panel>
      </ReactFlow>
    </div>
  );
}
