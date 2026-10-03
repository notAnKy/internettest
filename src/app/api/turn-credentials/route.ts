import "server-only";
import {
  meteredConfiguration,
  meteredCredentials,
} from "../../../lib/turn/metered";
import { requestSettings } from "../../../lib/turn/request-settings";

export const runtime = "nodejs";
export const maxDuration = 15;
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Origin",
  "X-Content-Type-Options": "nosniff",
};

function sameOrigin(request: Request) {
  // Next normalizes loopback request URLs and a reverse proxy may use an
  // internal hostname. Host remains the authority requested by the browser.
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if (/[\s\\/#?@]/.test(host)) return false;
  try {
    return (
      request.headers.get("origin") ===
      new URL(`${url.protocol}//${host}`).origin
    );
  } catch {
    return false;
  }
}

// This read-only check never fetches credentials or contacts Metered.
export function GET() {
  return Response.json(
    { configured: meteredConfiguration() !== null },
    { headers },
  );
}

export async function POST(request: Request) {
  const reply = (code: string, status: number, extra = {}) =>
    Response.json({ code }, { status, headers: { ...headers, ...extra } });
  if (
    !sameOrigin(request) ||
    request.headers.get("x-internettest-test") !== "packet-loss"
  )
    return reply("forbidden", 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    return reply("invalid-settings", 415);
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 8000);
  try {
    try {
      await requestSettings(request, controller.signal);
    } catch {
      return reply(
        controller.signal.aborted ? "request-timeout" : "invalid-settings",
        controller.signal.aborted ? 408 : 400,
      );
    }
    const config = meteredConfiguration();
    if (!config) return reply("setup-required", 503);
    const response = await meteredCredentials(config, controller.signal);
    if (response.status === "rate-limited")
      return reply("credentials-unavailable", 429, { "Retry-After": "60" });
    if (response.status !== "ready")
      return reply("credentials-unavailable", 502);
    return Response.json({ iceServers: response.iceServers }, { headers });
  } catch {
    // Never return or log upstream bodies, tokens, URLs containing IDs, or errors.
    return reply("credentials-unavailable", 502);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}

function methodNotAllowed() {
  return Response.json(
    { code: "method-not-allowed" },
    { status: 405, headers: { ...headers, Allow: "GET, HEAD, POST, OPTIONS" } },
  );
}
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { ...headers, Allow: "GET, HEAD, POST, OPTIONS" },
  });
}
