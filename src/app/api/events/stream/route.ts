import { withAdmin } from "@/server/http/admin";
import { gatewayEventSubscribers, subscribeToGatewayEvents } from "@/server/events/bus";

async function get(req: Request) {
  if (gatewayEventSubscribers() >= 32) {
    return Response.json({ error: "Too many dashboard streams" }, { status: 429 });
  }

  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      function enqueue(text: string) {
        if (closed) return;
        if ((controller.desiredSize ?? 0) <= 0) {
          cleanup();
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(text));
      }
      const unsubscribe = subscribeToGatewayEvents((event) => enqueue(`data: ${JSON.stringify(event)}\n\n`));
      const timer = setInterval(() => enqueue(": ping\n\n"), 25_000);
      const abort = () => {
        cleanup();
        controller.close();
      };
      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(timer);
        req.signal.removeEventListener("abort", abort);
      };

      req.signal.addEventListener("abort", abort, { once: true });
      if (req.signal.aborted) abort();
      else enqueue('data: {"type":"connected"}\n\n');
    },
    cancel() {
      cleanup();
    },
  }, { highWaterMark: 32 });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export const GET = withAdmin(get);
