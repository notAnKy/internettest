import "server-only";
import { validatePacketLossSettings } from "../packet-loss/settings";

// Bound actual bytes, not just Content-Length (which can be absent or forged).
export async function requestSettings(request: Request, signal: AbortSignal) {
  const length = request.headers.get("content-length");
  if (
    !request.body ||
    (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024))
  )
    throw new Error("Invalid request");
  const reader = request.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) throw new Error("Request aborted");
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error("Request aborted");
      if (done) break;
      size += value.byteLength;
      if (size > 1024) throw new Error("Invalid request");
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return validatePacketLossSettings(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
