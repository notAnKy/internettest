import "server-only";
import { udpIceServers } from "../packet-loss/turn";

// Verified 2026-10-03: credential-scoped apiKey, GET returning an ICE array.
// https://www.metered.ca/docs/turn-rest-api/get-credential/
// Free region: https://www.metered.ca/docs/turnserver-guides/turnserver-regions/
export function meteredConfiguration() {
  const configuredApp = process.env.METERED_APP_NAME?.trim().toLowerCase();
  // The dashboard displays a full domain; accept it as well as the app prefix.
  const appName =
    configuredApp?.match(
      /^(?:https:\/\/)?([a-z0-9-]+)\.metered\.live\/?$/,
    )?.[1] ?? configuredApp;
  const apiKey = process.env.METERED_TURN_API_KEY?.trim();
  return appName &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(appName) &&
    apiKey &&
    apiKey.length <= 512 &&
    !/\s/.test(apiKey)
    ? { appName, apiKey }
    : null;
}

export async function meteredCredentials(
  config: NonNullable<ReturnType<typeof meteredConfiguration>>,
  signal: AbortSignal,
) {
  const url = new URL(
    `https://${config.appName}.metered.live/api/v1/turn/credentials`,
  );
  url.searchParams.set("apiKey", config.apiKey);
  // Explicitly request the documented free endpoint; never fall back to Global.
  url.searchParams.set("region", "standard");
  const response = await fetch(url, {
    method: "GET",
    cache: "no-store",
    signal,
    redirect: "error",
  });
  if (response.status === 429) return { status: "rate-limited" } as const;
  if (response.status !== 200) return { status: "unavailable" } as const;
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) return { status: "unavailable" } as const;
  const iceServers = udpIceServers({ iceServers: payload });
  if (
    !iceServers.length ||
    iceServers.some((server) =>
      [server.username, server.credential].some(
        (value) => typeof value === "string" && value.includes(config.apiKey),
      ),
    )
  )
    return { status: "unavailable" } as const;
  // These are existing credential values, not freshly minted expiring values.
  return { status: "ready", iceServers } as const;
}
