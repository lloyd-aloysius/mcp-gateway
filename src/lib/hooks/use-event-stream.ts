"use client";

import { useEffect, useRef } from "react";

export type GatewayEvent =
  | { type: "connected" }
  | { type: "server.status_changed"; serverId: string; serverKey: string; status: string; lastError?: string | null }
  | { type: "endpoint.created"; endpointId: string }
  | { type: "endpoint.updated"; endpointId: string }
  | { type: "endpoint.deleted"; endpointId: string }
  | { type: "rule.updated"; endpointId: string; backendServerId: string }
  | {
      type: "call.started";
      callId: string;
      endpointId: string;
      endpointName: string;
      backendServerId: string | null;
      backendServerKey: string | null;
      itemName: string | null;
      operationType: string;
      sessionId: string | null;
      clientId: string | null;
    }
  | { type: "call.finished"; callId: string; status: "success" | "error" | "denied"; durationMs: number; error?: string }
  | { type: "audit.appended"; entryId: number };

export function useEventStream(onEvent: (event: GatewayEvent) => void) {
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as GatewayEvent;
        handlerRef.current(data);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);
}
