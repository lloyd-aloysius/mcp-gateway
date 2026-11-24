import { subscribeToGatewayEvents } from "@/server/events/bus";
import { viewerEvent } from "@/server/viewer/events";
import { authorizeViewer, viewerHeaders } from "@/server/http/viewer";

declare global { var __gatewayViewerStreams: number | undefined; }

export async function GET(request: Request) {
  const denied = authorizeViewer(request);
  if (denied) return denied;
  if ((globalThis.__gatewayViewerStreams ?? 0) >= 8) return Response.json({ error: "Too many visualization streams" }, { status: 429, headers: viewerHeaders() });
  globalThis.__gatewayViewerStreams = (globalThis.__gatewayViewerStreams ?? 0) + 1;
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      function enqueue(value: string) {
        if (closed) return;
        if (authorizeViewer(request) || (controller.desiredSize ?? 0) <= 0) { cleanup(); controller.close(); return; }
        controller.enqueue(encoder.encode(value));
      }
      const unsubscribe = subscribeToGatewayEvents((event) => {
        const projected = viewerEvent(event);
        if (projected) enqueue(`data: ${JSON.stringify(projected)}\n\n`);
      });
      const timer = setInterval(() => enqueue(": ping\n\n"), 25_000);
      const abort = () => { if (!closed) { cleanup(); controller.close(); } };
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe(); clearInterval(timer);
        globalThis.__gatewayViewerStreams = Math.max(0, (globalThis.__gatewayViewerStreams ?? 1) - 1);
        request.signal.removeEventListener("abort", abort);
      };
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      else enqueue('data: {"type":"connected"}\n\n');
    },
    cancel() { cleanup(); },
  }, { highWaterMark: 32 });
  return new Response(stream, { headers: { ...viewerHeaders(), "content-type": "text/event-stream", "x-accel-buffering": "no" } });
}

export function HEAD(request: Request) {
  const denied = authorizeViewer(request);
  return denied ?? new Response(null, { headers: { ...viewerHeaders(), "content-type": "text/event-stream", "x-accel-buffering": "no" } });
}
