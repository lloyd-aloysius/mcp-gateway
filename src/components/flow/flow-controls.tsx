"use client";

import { useReactFlow } from "@xyflow/react";
import { ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FlowControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card/90 p-1 shadow-md backdrop-blur-sm">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => zoomIn({ duration: 150 })}
        aria-label="Zoom in"
      >
        <ZoomIn className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => zoomOut({ duration: 150 })}
        aria-label="Zoom out"
      >
        <ZoomOut className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => fitView({ duration: 200, padding: 0.3 })}
        aria-label="Fit view"
      >
        <Maximize className="size-4" />
      </Button>
    </div>
  );
}
