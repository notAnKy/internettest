// Metered's documented free Standard endpoint. A bare `turn:` URL defaults
// to UDP (RFC 7065); normalize it explicitly. No STUN, TCP or TLS fallback.
export function udpIceServers(payload: unknown): RTCIceServer[] {
  if (!payload || typeof payload !== "object" || !("iceServers" in payload))
    return [];
  if (!Array.isArray(payload.iceServers)) return [];
  const servers: RTCIceServer[] = [];
  for (const server of payload.iceServers.slice(0, 10)) {
    if (!server || typeof server !== "object") continue;
    const { urls, username, credential } = server;
    if (
      typeof username !== "string" ||
      !username ||
      username.length > 512 ||
      typeof credential !== "string" ||
      !credential ||
      credential.length > 512
    )
      continue;
    const candidates = Array.isArray(urls) ? urls : [urls];
    const filtered = candidates
      .filter(
        (url): url is string =>
          typeof url === "string" &&
          /^turn:standard\.relay\.metered\.ca:(80|443)(?:\?transport=udp)?$/.test(
            url,
          ),
      )
      .map((url) => (url.includes("?") ? url : `${url}?transport=udp`));
    if (filtered.length)
      servers.push({ urls: [...new Set(filtered)], username, credential });
  }
  return servers;
}
