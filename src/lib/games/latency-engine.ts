import type { GameLatencyReport } from "../../types/games";
import { fortniteEuropeEndpoints } from "./fortnite";

/** Explicit unsupported branch of the separate game-latency layer.
 * Browser fetch/WS cannot send ICMP and no validated browser echo service
 * exists in this catalog. Never time errors, opaque responses or handshakes,
 * and never substitute Cloudflare RTT or server-side measurements.
 * This path allocates no requests, timers, listeners or animation frames,
 * so cancellation/unmount require no asynchronous cleanup. */
export function testFortniteRoutes(): GameLatencyReport {
  return {
    status: "unsupported",
    reason: "no-verified-browser-transport",
    results: fortniteEuropeEndpoints.map((endpoint) => ({
      game: endpoint.game,
      region: endpoint.region,
      subregion: endpoint.subregion,
      host: endpoint.host,
      latencyMs: null,
      jitterMs: null,
      samples: [],
      status: "unsupported",
      measurementType: "none",
    })),
    bestRoute: null,
  };
}
