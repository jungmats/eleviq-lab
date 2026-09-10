# ElevIQ Lab — Demo 1: Agent Identity (Web Bot Auth)

**Status (2026-09-10): built; restructured to the split architecture.** Real
client-side signing in the browser + standalone **gateway Worker** verification,
three scenarios green. Reference script + `/api/sign` test aid working.
Restructure to `docs/` (site) + `gateway/` (Worker) done; needs a re-test on the
new layout, then: deploy the gateway (`npm run deploy:gateway`) and turn on
GitHub Pages for `docs/`.

## Context

`eleviq.solutions` markets ElevIQ's AI agent-readiness and monetization consulting.
`technologies.html` *describes* the relevant stack (Web Bot Auth, robots.txt, RSL, HTTP 402,
x402, Pay Per Crawl, Bot Analytics) but shows nothing working.

**ElevIQ Lab** is an isolated playground (not indexed, link-only) with working, end-to-end
demonstrations of the problems agent-readiness engagements surface — and a reference
implementation clean enough to point a coding assistant at.

Full pipeline: **Identify → Decide → Charge → Measure** (+ "post-ad monetization").
This plan covers **Demo 1 — Identify** only. The landing page names the other three as
"coming" with no link.

## The demo, in one paragraph

A visiting **AI agent** requests one **protected resource** on the lab — a *Q3 partner price
list*. The presenter (Matthias, with a customer) controls how the agent behaves; the page
shows what the agent sent and what the server decided. Demo 1's only question is **"can the
server prove who this is?"** — yes/no. Unverified → public teaser. Verified → full document.
The richer allow/refuse/charge decision is Demo 2.

## Decisions made

- **Split architecture** — same shape as the Book Call attribution setup:
  - `docs/` → **GitHub Pages**, `lab.eleviq.solutions` (CNAME to `jungmats.github.io`).
    The explainer pages, the browser console, the reference material. Pure static;
    keeps the lab's static content on the same infra as `eleviq.solutions`.
  - `gateway/` → **Cloudflare Worker**, `eleviq-lab-gateway.gateway-worker.workers.dev`. The
    reference implementation: verifies agents, serves the key directory, later
    proxies to origin + policy + payment. This is the artifact ElevIQ deploys for
    a customer (Worker route / Custom Domain in front of their endpoint).
  - Chosen over unified Cloudflare Pages because a Pages project hosts a *site*; a
    Worker *intercepts requests* — only the Worker shape transfers to a customer.
- **No nameserver move for v1.** Gateway on `*.workers.dev`; the demo shows two
  origins (`lab.eleviq.solutions` + `…workers.dev`) — revisit when the zone moves
  to Cloudflare for Charge/Measure.
- **Isolation:** noindex + obscurity. `X-Robots-Tag` set by the gateway wrapper
  and `<meta robots>` on the pages; `docs/robots.txt` disallow; no inbound links.
- **Language:** TypeScript. Gateway is a `fetch()` handler + a ~40-line router
  (like `booking/_gateway-worker`); `src/lib/*` is host-agnostic.
- **Library:** `web-bot-auth@0.2.0` (Cloudflare) — `sign`/`verify`,
  `signerFromJWK`/`verifierFromJWK` from `web-bot-auth/crypto`. Ed25519. Real crypto.
- **Keys:** committed DEMO keypairs in `gateway/keys/` (source of truth). `npm run
  build` copies them to `docs/reference/` for the console + download. One-way copy,
  no sync problem.
- Cloudflare's *native edge* Web Bot Auth ("option 3": network verifies, app reads a
  signal, requires the customer's domain to be a Cloudflare zone) is a **later phase**, not
  v1. The page contrasts the two in "Where the check runs".
- **Resource:** a concrete document — "Q3 partner price list". Unverified = teaser, verified
  = full list.
- **Scenarios v1: three.** `valid` · `unsigned` · `unknown-key`. Add `expired` + `tampered`
  once the page shape is settled.
- **In-page signing is client-side (honest):** the page holds a *demo agent* Ed25519 private
  key and signs in the browser with `web-bot-auth` (vendored browser bundle via a small
  esbuild step). The agent genuinely signs; the verifier is the separate gateway Worker.
- **External testing is a first-class requirement** — see below.
- **Demo keypairs are committed**, marked `DEMO — not a production secret`, so everything
  runs with zero secret setup. `scripts/gen-keys.mjs` + a README note cover the Cloudflare
  Secrets path for production.
- **Styling:** copy `styles.css` from the main site; add `lab.css` for the console. Same
  header/footer/logo; logo links to `https://eleviq.solutions`.

## Four ways to exercise the demo (external testing)

The verifier endpoint is plain public HTTP. Anyone — curl, a CLI, an AI assistant with a
fetch tool — hits the same endpoint and gets the same verdict.

1. **The page** — in-browser, client-side signing. For the live customer walkthrough.
2. **Plain GET** (any tool, any assistant, zero setup) — unsigned request returns
   `401` + `application/problem+json` that explains *how* to authenticate and links the key
   directory + reference script. Demonstrates the "no auth" path and the discovery mechanism.
3. **`/api/sign` test helper** (curl / assistant, no repo needed) — `POST` a target path +
   scenario, get signed headers back, replay them against the resource. **Labelled loudly as
   a test aid, not part of the security model.** Also serves the `unknown-key` scenario
   (signs with a key absent from the directory).
4. **`reference/sign-request.mjs`** (Node + repo clone) — real client-side signing with the
   committed demo key; prints a ready-to-run `curl` (or sends the request with `--send`).
   The actual code path an agent implements.

Future: an MCP endpoint exposing a `fetch_as_agent` tool for connected assistants, mirroring
`booking/_gateway-worker`.

## Page layout — `docs/identity/index.html` (as built)

1. **The problem** — spoofable IP/User-Agent → cryptographic signature.
2. **The demo** — "you are the agent" callout; controls: 3 scenarios (`valid` ·
   `unsigned` · `unknown-key`) + claimed-identity dropdown (3 operator stand-ins);
   panes: *what the agent sent* (request wire + copy-as-curl) / *what the server did*
   (verdict badge + extracted facts) / response body / request log.
3. **Where the check runs** — the gateway is a standalone Worker = the customer artifact;
   one DNS record for the customer; standard, portable; option 3 (edge) is later.
4. **Without / with** — fixed two-column contrast.
5. **Test it from your own tools** — A ask an assistant · B unsigned curl · C `/api/sign`
   helper · D reference script. URLs: gateway = `eleviq-lab-gateway.gateway-worker.workers.dev`,
   downloads = `lab.eleviq.solutions/reference/`.

**Verdict panel** = the visual feedback of every agent action: large coloured status
(✅ VERIFIED / ⛔ REFUSED / ⚠️ REJECTED), plain-language reason, and the facts the server
extracted — which key, which agent + operator, signed how many seconds ago, valid for how
long.

**Presenter controls:** (1) agent behaviour — the 3 scenarios; (2) claimed User-Agent
string, to show claim-vs-proof; (3) later: which agent identity signs, replay button.

## Repo layout

```
README.md · package.json · .gitignore
build/bundle.mjs · build/agent-sign.entry.js   — esbuild the browser bundle + copy keys
scripts/gen-keys.mjs                            — regenerate the demo keypairs

docs/                        static site → GitHub Pages (lab.eleviq.solutions)
  index.html                 lab landing page
  identity/index.html        Demo 1 page  (<meta name="gateway"> sets the gateway URL)
  styles.css · lab.css · robots.txt · CNAME · .nojekyll
  assets/console.js          scenario → sign in-browser → call gateway → render
  assets/agent-sign.js       generated + committed: web-bot-auth for the browser
  assets/eleviq_icon.png · eleviq_logo_v1.6.png
  reference/README.md · sign-request.mjs        the reference signer
  reference/*.jwk.json        generated + committed: demo keys (copied from gateway/keys/)

gateway/                     the gateway Worker → Cloudflare (eleviq-lab-gateway.gateway-worker.workers.dev)
  wrangler.toml · tsconfig.json
  src/index.ts               fetch handler: OPTIONS · / · route dispatch · 404 · noindex wrapper
  src/routes/directory.ts    GET /.well-known/http-message-signatures-directory
  src/routes/price-list.ts   GET /api/identity/price-list → 200 full list | 401 teaser + problem+json
  src/routes/sign.ts         POST /api/sign → LABELLED test-aid signer (valid | unknown-key | expired)
  src/lib/keys.ts            load committed demo JWKs; keyid → operator registry; directory list
  src/lib/verify.ts          wrap web-bot-auth verify(); resolver checks keyid vs trust store; typed verdict
  src/lib/http.ts            json() / problem() (application/problem+json) / CORS helpers
  keys/*.jwk.json            committed DEMO keypairs (openai · anthropic · perplexity · demo-agent · untrusted-agent)
```

## Key implementation notes

- **`gateway/src/lib/verify.ts`** — resolver resolves keyid **only** from the trust store
  (never trusts the candidate). Validates `created`/`expires` with clock skew. Typed reason
  on every failure path: `unsigned` · `unknown-key` · `expired` · `invalid`.
- **`gateway/src/routes/sign.ts`** — signs with `target: "@target-uri"` so the signature is
  bound to the full URL. `Signature-Agent` = the gateway origin (its directory is the
  gateway's own well-known endpoint). Loud DEMO/TEST-AID banner in the JSON response.
- **Browser bundle** — `npm run build` emits `docs/assets/agent-sign.js` from `web-bot-auth`
  and copies `gateway/keys/*` → `docs/reference/`. Both are **committed** (GitHub Pages
  serves committed files; no CI).
- **console.js gateway URL** — from `<meta name="gateway">`, except on `localhost` where it
  always targets `http://localhost:8787` (so `npm run dev:*` works).
- **noindex** — set by the gateway's `withHeaders()` wrapper and `<meta robots>` on the
  pages; `docs/robots.txt` disallows all.
- **Identities** — 4 trusted keys (3 operator stand-ins + demo-agent) + 1 untrusted. The
  page states the operator keys are lab stand-ins, not the operators' real keys.

## What the user does (outside this scaffold)

1. Create the GitHub repo `jungmats/eleviq-lab`; from the repo:
   `git add -A && git commit && git remote add origin … && git push -u origin main`.
   (User owns git.)
2. **Gateway:** `npm install && npm run deploy:gateway` (first run: `wrangler login`).
   → `eleviq-lab-gateway.<subdomain>.workers.dev`. If the subdomain differs from
   `eleviq-lab-gateway.gateway-worker.workers.dev`, update `<meta name="gateway">` in
   `docs/identity/index.html` and the URLs in §5 + `docs/reference/`.
3. **Site:** GitHub repo → Settings → Pages → deploy from `main` / `/docs`. Add the
   `lab.eleviq.solutions` CNAME record at the DNS host (→ `jungmats.github.io`).
4. No secrets in v1.

## Verification (end-to-end)

Local — `npm install && npm run build`, then in two shells `npm run dev:gateway` and
`npm run dev:site`, visit `http://localhost:8000`:
- Landing page renders in ElevIQ styling; Identify links to the demo, others "coming".
- Demo 1: `valid` → ✅ VERIFIED + full price list; `unsigned` → ⛔ REFUSED + teaser +
  problem+json; `unknown-key` → ⚠️ REJECTED (untrusted key).
- `curl -s localhost:8787/.well-known/http-message-signatures-directory` → keys, with
  `Content-Type: application/http-message-signatures-directory+json`.
- `node sign-request.mjs --url http://localhost:8787/api/identity/price-list --send`
  → 200 + full list. Plain `curl` (no signature) → 401 + problem+json.
- `curl -sI` any gateway URL shows `X-Robots-Tag: noindex, nofollow`.

Deployed: repeat against `https://eleviq-lab-gateway.gateway-worker.workers.dev` and
`https://lab.eleviq.solutions`.

## Later (not this plan)

- Scenarios `expired` + `tampered`.
- Demo 2 — Decide: policy engine, 403/402, robots.txt Content Signals + RSL "stated vs
  enforced" contrast.
- Demo 3 — Charge: Pay Per Crawl walkthrough + real x402 (testnet USDC on Base).
- Demo 4 — Measure: attribution dashboard (Workers Analytics Engine, AI-referral tracking).
- MCP endpoint (`fetch_as_agent`), custom domain `lab.eleviq.solutions`, DNS move to Cloudflare.
