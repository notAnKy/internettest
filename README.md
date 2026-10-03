# InternetTest

A browser-based internet speed, connection quality, and packet-loss testing tool.

## Features

- Download/upload speed, ping, jitter, and loaded latency, with smooth live readings.
- Connection suitability for gaming, streaming, browsing, and video calls; bufferbloat analysis.
- Independent `/packet-loss` page with Quick, Default, Gaming, Voice call, Video call, and Stability presets.
- Adjustable message size, frequency, duration, acceptable delay, and optional warm-up.
- Loss, lateness, delivery delay/jitter, a delivery chart, and dated CSV/JSON exports.

History is visibly marked **Soon** and disabled. No accounts or game-server tests are provided.

## Tech stack

Next.js 16.3.8 App Router, React 19.3, TypeScript, Tailwind CSS 4, Lucide React, and Cloudflare speedtest 1.14.1. Node.js 24.x and pnpm 11.19.0 are pinned; `pnpm-lock.yaml` is the dependency lockfile. Playwright, ESLint, and Prettier are development tools.

## How the tests work

**Speed:** transfers go directly from the browser to Cloudflare infrastructure. The app server does not serve bandwidth payloads. Start is manual; optional Cloudflare result logging is disabled. A complete run can request about 117 MB of payload, plus overhead. Idle ping is HTTP timing, not raw ICMP. Loaded latency can be unavailable when transfers are too short or browser timing is restricted. Final readings come from provider aggregates; animation changes only the display.

**Packet loss:** two local WebRTC peers exchange numbered, unordered messages through Metered Standard TURN over verified UDP, with retransmission disabled. Both selected paths must prove UDP relay transport. Settings are validated before credentials are fetched and again before measurement; the server independently validates the same settings. An optional 2-second warm-up is excluded from recorded counts, and a final receive window allows up to 5 seconds for arrivals. Cancel, timeout, and navigation close connections and timers. No deliveries or unverifiable transport produce **Unavailable**, not a fabricated 100% loss result.

Loss is `(sent - received) / sent × 100`, counting unique messages. A received message above **acceptable delay** is late and still received; late percentage uses all recorded messages as its denominator. Average delay uses received messages. Jitter is the mean absolute delay change between successive received messages in sequence order. The same browser clock measures delivery between the two local peers; this is relay delivery delay, not game ping or echo-server RTT. Exports contain only validated diagnostic fields and settings.

## Local setup

Install Node.js 24 and pnpm 11.19.0, then:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open [localhost:3000](http://localhost:3000). If pnpm is unavailable, use `npx --yes pnpm@11.19.0` in its place. After installing dependencies, `npm run dev` is also supported. Speed testing needs no environment variables.

```sh
pnpm test       # deterministic unit tests, no real network tests
pnpm lint
pnpm typecheck
pnpm build
pnpm start
pnpm test:release
```

`test:release` runs units, lint, typecheck, one production build with synthetic secret canaries, a secret/bundle audit, and one production smoke check at 1366px and 390px. It owns and stops its local production server, uses mocked WebRTC for the browser measurement, blocks external speed traffic, and writes no screenshot reports on success. It never uses live TURN credentials. Run it with Edge installed on Windows, or install Playwright Chromium with `pnpm exec playwright install chromium` on other systems. `BROWSER_CHANNEL` can select an installed Chrome browser for QA; it is not a production variable.

## Environment variables and Metered setup

Copy `.env.example` to `.env.local`. Only these optional server-side variables are needed for packet loss:

| Variable               | Value                                                  |
| ---------------------- | ------------------------------------------------------ |
| `METERED_APP_NAME`     | Metered app prefix or full `<app>.metered.live` domain |
| `METERED_TURN_API_KEY` | Credential-specific TURN API key                       |

In the [Metered dashboard](https://dashboard.metered.ca/v2), open **TURN Server → Credentials → Create Credential**. On the credential row choose **Get credential → Show API Key**. Find the app domain under **Developers**. Use the credential-specific API key, not the account-wide Developers Secret key. Allow up to two minutes for a new credential to propagate, then restart the local server. See [Metered's quickstart](https://www.metered.ca/docs/turn-server-service/quickstart/).

## Security and quota protection

`.env.local` and other local environment files are ignored. `.env.example` contains placeholders only. Never use a `NEXT_PUBLIC_` prefix for either variable. `/api/turn-credentials` returns a setup boolean on GET; credentials require a same-origin POST with a JSON settings body. The POST has a 1 KiB body limit, strict field/range/budget validation, an 8-second total body/upstream timeout, no-store responses, safe errors, and an allowlist of Standard UDP TURN URLs. PUT/PATCH/DELETE return 405. Upstream errors and credentials are never logged by this endpoint.

The browser necessarily receives the TURN username/password required for WebRTC. The API key remains server-side. Metered returns existing credentials; they are **not newly minted short-lived credentials**. Revoke or rotate them in Metered when needed. Credential values and ICE configuration are excluded from exports, fixtures, and persisted diagnostic results.

Per-test limits: 64–1200-byte payloads, 1–60 messages/second, 5–60 seconds, at most **1,800 recorded messages**, **1,920 total messages including warm-up**, and **1 MiB application payload including warm-up**. Protocol and relay overhead add usage. Excessive slider combinations cannot start. Only one test runs per page at a time. Quick and 60-second Stability presets remain within these budgets.

These are diagnostic safeguards, **not strong abuse prevention**: a non-browser caller can forge Origin, and a determined client can bypass the UI or reuse runtime TURN credentials. There is no misleading in-memory serverless rate limiter. Use Metered dashboard quota/usage controls and credential revocation; before wide public traffic, consider a persistent edge rule for this POST route using [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting), subject to your plan. Edge limits protect endpoint requests, not reused TURN credentials. Use the allowance actually shown in your Metered dashboard; published free allowances differ.

## Limitations

- Gaming quality means general connection suitability, **not actual game-server ping**.
- Packet loss is WebRTC message delivery over one TURN route, **not raw ICMP**, exact wire-packet loss, or separate upload/download loss. There is one Standard relay route, not a selectable city list.
- Zero observed loss is a sample, not a long-term stability guarantee. Browser scheduling, background tabs, VPNs, Wi-Fi, and other traffic affect results. Keep the test tab active.
- UDP access, browser relay statistics, Cloudflare/Metered availability, and TURN quota are external dependencies. Missing measurements stay unavailable.
- Recent speed results are saved in this browser's local storage; packet-loss results and credentials are not persisted by the app. Export files remain wherever the user saves them.

## Deployment to Vercel

Use the standard [Next.js framework preset](https://vercel.com/docs/frameworks/nextjs), repository root, and [Node.js 24.x](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions). To install the exact pinned package-manager version without extra environment flags, set:

- Install command: `npx --yes pnpm@11.19.0 install --frozen-lockfile`
- Build command: `npm run build`
- Output directory: leave the Next.js default.

Add **only** `METERED_APP_NAME` and `METERED_TURN_API_KEY` in Vercel's **Production** environment. Add them separately to Preview only if preview deployments should support packet loss. Treat the API key as sensitive. Redeploy after changing variables. No public secrets, site URL, database, account Secret key, or extra production variables are required.

`/` and `/packet-loss` are real App Router pages, so direct visits and refreshes work. The credential route uses a Node.js serverless function with a 15-second platform duration declaration; its own 8-second timeout ends requests earlier. WebRTC traffic runs in the browser, so a 60-second diagnostic does not hold the serverless function open. No localhost URLs, Windows paths, production filesystem writes, or persistent processes are required in runtime code. A static-only export would not support the credential route.

Before publishing, run `pnpm test:release`, review `git status`, and leave `.env.local`, `.next`, `node_modules`, `.pnpm-store`, `artifacts`, browser traces/profiles, and `.vercel` out of commits. This hardening task does not commit, push, or deploy.

## License and notices

InternetTest original code is [MIT licensed](LICENSE). Adapted Cloudflare logic retains its complete original MIT notice. [Third-party notices](THIRD_PARTY_NOTICES.md) identify the adaptation and runtime packages; full permission notices, including Lucide/Feather, ship at `/third-party-notices.txt`. No code was copied from packetlosstest.com.
