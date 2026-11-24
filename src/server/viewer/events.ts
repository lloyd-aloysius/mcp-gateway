import type { GatewayEvent } from "../events/bus";

// Explicit projections prevent future admin fields from leaking into this feed.
export function viewerEvent(event: GatewayEvent): GatewayEvent | null {
  switch (event.type) {
    case "server.status_changed": return { type: event.type, serverId: event.serverId, serverKey: event.serverKey, status: event.status };
    case "client.changed":
    case "endpoint.created":
    case "endpoint.updated":
    case "endpoint.deleted": return { type: event.type, endpointId: event.endpointId };
    case "call.started": return { type: event.type, callId: event.callId, endpointId: event.endpointId, endpointName: event.endpointName, backendServerId: event.backendServerId, backendServerKey: event.backendServerKey, itemName: event.itemName, operationType: event.operationType, sessionId: null, clientId: event.clientId };
    case "call.finished": return { type: event.type, callId: event.callId, status: event.status, durationMs: event.durationMs };
    default: return null;
  }
}
