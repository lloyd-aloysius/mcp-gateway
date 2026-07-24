"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps, type Edge } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type PulseEdgeData = {
  pulseStatus: "idle" | "active" | "success" | "error" | "denied";
  label?: string;
};

const STATUS_COLOR: Record<string, string> = {
  idle: "var(--border)",
  active: "var(--primary)",
  success: "#10b981",
  error: "#ef4444",
  denied: "#f59e0b",
};

export function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<Edge<PulseEdgeData>>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const status = data?.pulseStatus ?? "idle";
  const active = status !== "idle";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: STATUS_COLOR[status],
          strokeWidth: active ? 2.5 : 1.5,
          transition: "stroke 0.3s, stroke-width 0.3s",
        }}
        className={cn(active && status === "active" && "animate-pulse")}
      />
      {status === "active" && (
        <EdgeLabelRenderer>
          <div
            className="edge-travel-chip"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 8,
              height: 8,
              borderRadius: "9999px",
              background: STATUS_COLOR.active,
              offsetPath: `path('${edgePath}')`,
              offsetRotate: "0deg",
              boxShadow: `0 0 8px 1px ${STATUS_COLOR.active}`,
            }}
          />
        </EdgeLabelRenderer>
      )}
      {active && data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="rounded-md border bg-popover px-1.5 py-0.5 font-mono text-[10px] shadow-sm"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
