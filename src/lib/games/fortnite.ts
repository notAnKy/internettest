import type { FortniteEndpoint } from "../../types/games";

// Epic's CURRENT subregion documentation, checked 2026-10-03:
// https://www.epicgames.com/help/c-34254770/c-37371353/a22355516
// Epic documents ICMP, not HTTP/WS echo. One browser capability investigation
// received no response on HTTP(S) or WS(S). This is not proof of CORS denial.
export const fortniteSource =
  "https://www.epicgames.com/help/c-34254770/c-37371353/a22355516";
export const fortniteEuropeEndpoints: readonly FortniteEndpoint[] = [
  {
    game: "fortnite",
    region: "Europe",
    subregion: "France",
    host: "ping-fr.ds.on.epicgames.com",
    documentedTransport: "icmp",
    browserTransport: null,
  },
  {
    game: "fortnite",
    region: "Europe",
    subregion: "Germany",
    host: "ping-de.ds.on.epicgames.com",
    documentedTransport: "icmp",
    browserTransport: null,
  },
  {
    game: "fortnite",
    region: "Europe",
    subregion: "United Kingdom",
    host: "ping-gb.ds.on.epicgames.com",
    documentedTransport: "icmp",
    browserTransport: null,
  },
];
