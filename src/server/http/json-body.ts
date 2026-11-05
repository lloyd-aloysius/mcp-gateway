const ADMIN_BODY_BYTES = 128 * 1024;
export const MCP_BODY_BYTES = 1024 * 1024;

export class InvalidRequestBody extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function readJsonBody(request: Request, limit = ADMIN_BODY_BYTES): Promise<unknown> {
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw new InvalidRequestBody(415, "Content-Type must be application/json");
  if (Number(request.headers.get("content-length")) > limit) {
    throw new InvalidRequestBody(413, "Request body is too large");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new InvalidRequestBody(400, "A JSON request body is required");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => {});
        throw new InvalidRequestBody(413, "Request body is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch (error) {
    if (error instanceof InvalidRequestBody) throw error;
    throw new InvalidRequestBody(400, "Invalid JSON request body");
  } finally {
    reader.releaseLock();
  }
}
