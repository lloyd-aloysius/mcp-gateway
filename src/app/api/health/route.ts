export function GET() {
  return Response.json({ status: "live" }, { headers: { "cache-control": "no-store" } });
}
