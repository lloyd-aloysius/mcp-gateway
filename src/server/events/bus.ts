import { EventEmitter } from "node:events";

export type GatewayEvent =
  | { type: "server.status_changed"; serverId: string; serverKey: string; status: string; lastError?: string | null }
  | { type: "client.changed"; endpointId: string }
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
  | {
      type: "call.finished";
      callId: string;
      status: "success" | "error" | "denied";
      durationMs: number;
      error?: string;
    }
  | { type: "audit.appended"; entryId: number };

declare global {
  var __gatewayEventBus: EventEmitter | undefined;
}

const bus = (globalThis.__gatewayEventBus ??= new EventEmitter());
bus.setMaxListeners(100);


export function emitGatewayEvent(event: GatewayEvent) {
  bus.emit("event", event);
}

export function subscribeToGatewayEvents(
  listener: (event: GatewayEvent) => void
): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

export function gatewayEventSubscribers(): number {
  return bus.listenerCount("event");
}
