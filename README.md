# ElevIQ Lab

Working demonstrations of the agentic web — companion to
[eleviq.solutions/technologies.html](https://eleviq.solutions/technologies.html).

Unlisted: not indexed, no inbound links. The gateway is publicly reachable by
design — it's what a visiting agent talks to.

## Architecture

Same shape as the Book Call attribution setup: a **static demo site** driving a
**standalone gateway Worker**.

```
docs/       →  GitHub Pages  →  https://lab.eleviq.solutions
              the explainer pages + the browser console + the reference material

gateway/    →  Cloudflare Worker  →  https://eleviq-lab-gateway.gateway-worker.workers.dev
              the reference implementation: verifies visiting agents, serves the
              key directory, and (later) applies policy / payment / origin proxy.
              This is the artifact ElevIQ deploys for a customer.
```

The console (on the site) signs a request in the browser and calls the gateway
cross-origin. Nothing is simulated — real Ed25519 signing and verification.

## Status

| Demo | | |
|---|---|---|
| **1 · Identify** | agent identity via Web Bot Auth | ✅ built — `/identity/` |
| **2 · Decide** | policy-based access / refusal | ✅ built — `/decide/` |
| **3 · Delegate** | agent acting on behalf of a user (real emailed one-time code) | ✅ built — `/delegate/` |
| 4 · Charge | HTTP 402 · Pay Per Crawl · x402 | planned |
| **5 · Measure** | attribution dashboards | ✅ built — `/measure/` (Demo 1's log) + `insights.eleviq.solutions` (site traffic, behind Cloudflare Access) |
| 6 · Sustain | post-ad monetization — scope tbd, likely several demos | planned |

See [`PLAN.md`](PLAN.md).

## Gateway endpoints

| | |
|---|---|
| `GET /` | describes the gateway |
| `GET /.well-known/http-message-signatures-directory` | the trusted public keys (currently one: "ElevIQ Lab demo agent") |
| `GET /api/identity/price-list` | the protected resource — `200` for a verified agent, else `401` + how-to-authenticate |
| `POST /api/sign` | **test aid** — signs with a demo key so you can try the verified path with just curl. Not part of the security model. |
| `GET /.well-known/rsl.xml` | Demo 2's STATED policy — a real, spec-shaped RSL license for `/api/decide/deal-notes` |
| `GET /api/decide/deal-notes` | Demo 2's protected resource — `200` for a verified agent declaring a permitted `X-Agent-Purpose`, else `403` + why (or `401` if unverified) |
| `POST /api/delegate/request-code` | Demo 3 — emails a one-time code to the claimed address (Resend); rate-limited; never returned in the response |
| `GET /api/delegate/account` | Demo 3's protected resource — `200` with a valid code for the claimed email (`X-Acting-For`, `X-Delegation-Code`), else `401`/`403` |

Trust is a single throwaway key — no OpenAI/Anthropic/etc. impersonation. The
console's "claimed identity" dropdown only sets an unverified claim
(`X-Demo-Agent-Claim` / `User-Agent`); the verified identity always comes from
the key. See `identity/index.html` §3 "What makes a real agent's key
trustworthy" for what a real deployment adds (a secret key + a vetted registry).

## Access log

Every request to `/api/identity/price-list` and `/api/decide/deal-notes` is
logged to D1 (`access_log` table, see `gateway/schema.sql`) — timestamp, path,
outcome, status, the verified key/agent if any, the claimed identity, and (for
Demo 2 only) the declared purpose and policy decision. Backs the `/measure/`
dashboard. Inspect it directly with:

```bash
npx wrangler d1 execute eleviq-lab-log --config gateway/wrangler.toml --remote \
  --command "SELECT ts, outcome, status, agent_name, claimed_ua FROM access_log ORDER BY ts DESC LIMIT 20"
```

## Develop

```bash
npm install
npx wrangler d1 execute eleviq-lab-log --config gateway/wrangler.toml --local --file=gateway/schema.sql  # once
npm run build          # bundles web-bot-auth for the browser, copies demo keys into docs/reference/
npm run dev:gateway    # gateway Worker at http://localhost:8787
npm run dev:site       # static site at http://localhost:8000 (console auto-targets :8787 on localhost)
```

- `npm run keys` regenerates the demo keypairs in `gateway/keys/`.
- `npm run typecheck` runs `tsc` over the gateway.
- After `npm run build`, **commit** `docs/assets/agent-sign.js` and
  `docs/reference/*.jwk.json` — GitHub Pages serves committed files directly.

### Layout

```
docs/                        static site → GitHub Pages
  index.html                 lab landing page
  identity/index.html        Demo 1 page  (<meta name="gateway"> sets the gateway URL)
  decide/index.html          Demo 2 page
  assets/console.js          Demo 1 console — signs in-browser, calls the gateway
  assets/decide.js           Demo 2 console — same identity, varies declared purpose
  assets/agent-sign.js       generated: web-bot-auth bundled for the browser (committed)
  reference/                 sign-request.mjs + README + demo keys (keys generated, committed)
  CNAME                      lab.eleviq.solutions
gateway/                     the gateway Worker → Cloudflare
  wrangler.toml
  src/index.ts               router (fetch handler)
  src/routes/                directory · price-list · sign · deal-notes · license ·
                             delegate-request-code · delegate-account
  src/lib/                   verify · keys · http · policy · rsl · delegation
  keys/                      committed DEMO keypairs (source of truth)
build/bundle.mjs             esbuild step for the browser bundle
scripts/gen-keys.mjs         regenerate the demo keypairs
```

Demo keys are committed (v1 had no secrets at all). For a real deployment:
fresh keys, private halves in Cloudflare secrets, only public halves in the
directory.

Demo 3's delegation email is the lab's first real secret: `RESEND_API_KEY`
(Resend, sending as `delegate@lab.eleviq.solutions`, domain verified in
Resend via DNS records on that zone). Local dev: add
`RESEND_API_KEY=re_...` to `gateway/.dev.vars` (gitignored). Remote:
`npx wrangler secret put RESEND_API_KEY` from `gateway/`.

## Deploy

**Gateway** — `npm run deploy:gateway` (`wrangler deploy`). First run does
`wrangler login`. Ships to `eleviq-lab-gateway.<subdomain>.workers.dev`.

**Site** — GitHub Pages, serving from `/docs` on `main`. Custom domain
`lab.eleviq.solutions` via a `CNAME` DNS record to `jungmats.github.io`
(the `docs/CNAME` file is already in place).
