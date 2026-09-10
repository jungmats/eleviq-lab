# ElevIQ Lab — Demo 1: Agent Identity (Web Bot Auth)

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

- **Hosting:** Cloudflare Pages + Pages Functions, deployed as `eleviq-lab.pages.dev`.
  No domain move for v1.
- **Deployment:** Pages Git integration (auto-deploy + previews) + `wrangler pages dev` local.
- **Isolation:** noindex + obscurity only. `X-Robots-Tag: noindex,nofollow` on every
  response via `functions/_middleware.ts`, `robots.txt` disallow, `<meta robots>` per page,
  no inbound links, private repo. API endpoints stay publicly reachable — they are the demo.
- **Edge language:** TypeScript (Pages Functions compile it natively).
- **Library:** `web-bot-auth@0.2.0` (Cloudflare) — `sign`/`verify` from `web-bot-auth`,
  `signerFromJWK`/`verifierFromJWK` from `web-bot-auth/crypto`. Ed25519. Real crypto.
- **Verification runs in the Pages Function** (our code + Cloudflare's `web-bot-auth`
  library) — "option 2". This is the **v1 deployment model** and the one ElevIQ would offer
  customers: ElevIQ hosts and maintains the gateway on Cloudflare; the customer points an
  agent-facing endpoint at it with one DNS record (subdomain `CNAME`, or a Worker route if
  already on Cloudflare). Least invasive — no customer code, plugin, or server.
  Cloudflare's *native edge* Web Bot Auth ("option 3": network verifies, app reads a
  signal, requires the customer's domain to be a Cloudflare zone) is a **later phase**, not
  v1. The page contrasts the two in "Where the check runs".
- **Resource:** a concrete document — "Q3 partner price list". Unverified = teaser, verified
  = full list.
- **Scenarios v1: three.** `valid` · `unsigned` · `unknown-key`. Add `expired` + `tampered`
  once the page shape is settled.
- **In-page signing is client-side (honest):** the page holds a *demo agent* Ed25519 private
  key and signs in the browser with `web-bot-auth` (vendored browser bundle via a small
  esbuild step). The agent genuinely signs; the verifier is a separate Pages Function.
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

## Page layout — `public/identity/index.html`

```
Header:  [ElevIQ logo → eleviq.solutions]   ElevIQ Lab · Agent Identity (Web Bot Auth)

1 · THE PROBLEM
   3–4 sentences: server sees an IP + a User-Agent, both trivially spoofed; can't tell an
   accountable agent from a scraper wearing its name. Web Bot Auth = a signature the agent
   can't fake and you verify in ~1 ms at the edge.

2 · THE DEMO
   "A visiting agent requests a protected resource on this lab — the Q3 partner price list.
    Choose how the agent behaves, send the request, watch the server's decision."

   ┌ YOU CONTROL — the visiting agent ───────────────────────┐
   │  Behaviour:  ● Valid signature                          │
   │              ○ No signature                             │
   │              ○ Unknown key                              │
   │  Claimed identity (User-Agent): [ ChatGPT-User    ▾ ]   │
   │    hint: set to "ClaudeBot" with "No signature" — the   │
   │    claim changes, the proof doesn't                     │
   │                 [  Send request →  ]                    │
   └────────────────────────────────────────────────────────┘

   ┌ WHAT THE AGENT SENT ─────────┬ WHAT THE SERVER DID ──────┐
   │ GET /api/identity/price-list │  ⛔ REFUSED · 401          │
   │ Host: eleviq-lab.pages.dev   │  no signature — identity  │
   │ User-Agent: ChatGPT-User     │  cannot be verified       │
   │ Signature-Input: ...         │  Verified as:  —          │
   │ Signature: :...:             │  Key:          —          │
   │ Signature-Agent: ...         │  Signed:       —          │
   │ [ copy as curl ]             │  Valid for:    —          │
   └──────────────────────────────┴───────────────────────────┘

   ┌ RESPONSE BODY ─────────────────────────────────────────┐
   │ { "access": "public", "teaser": "...",                 │
   │   "note": "Full list requires a verified agent" }      │
   └───────────────────────────────────────────────────────┘

   Log: one line appended per send — "12:04:03 · valid · VERIFIED as ChatGPT-User (OpenAI)"

3 · WITHOUT / WITH   (fixed, always visible)
   Without Web Bot Auth            |  With Web Bot Auth
   identity is a claim             |  identity is a proof
   "ChatGPT-User" = anyone         |  bound to the operator's published key
   block/allow by IP range         |  allow / refuse / charge per verified agent
   no accountability               |  audit trail per identity

4 · HOW AN AGENT REALLY DOES THIS
   • the copy-as-curl above
   • reference/sign-request.mjs — client-side signing, the code a real agent runs
   • this lab's key directory: /.well-known/http-message-signatures-directory
   • one paragraph: Cloudflare verifies this automatically at the edge; here we verify in a
     Pages Function so you can see inside.
```

**Verdict panel** = the visual feedback of every agent action: large coloured status
(✅ VERIFIED / ⛔ REFUSED / ⚠️ REJECTED), plain-language reason, and the facts the server
extracted — which key, which agent + operator, signed how many seconds ago, valid for how
long.

**Presenter controls:** (1) agent behaviour — the 3 scenarios; (2) claimed User-Agent
string, to show claim-vs-proof; (3) later: which agent identity signs, replay button.

## Repo layout (Demo-1 slice)

```
README.md · package.json · tsconfig.json · wrangler.toml · .gitignore · .dev.vars.example
build/                     — esbuild config for the browser bundle
public/
  index.html               — lab landing page (pipeline; Identify linked, others "coming")
  styles.css               — copied from main site
  lab.css                  — console styles
  robots.txt               — Disallow: /
  identity/index.html      — Demo 1 page
  assets/
    agent-sign.js          — vendored browser bundle of web-bot-auth (esbuild output)
    console.js             — Demo 1 console logic (scenario → sign → fetch → render)
    eleviq_logo_v1.6.png · icon.png   — copied from main site
functions/
  _middleware.ts           — X-Robots-Tag: noindex,nofollow on all responses
  .well-known/
    http-message-signatures-directory.ts  — serves trusted Ed25519 public keys,
                             Content-Type application/http-message-signatures-directory+json
  api/
    identity/
      price-list.ts        — the protected resource: verify → 200 full list | 401 teaser + problem+json
    sign.ts                — LABELLED test-aid signer (valid | unknown-key)
  lib/
    keys.ts                — load committed demo JWKs (+ env override), thumbprint helpers
    verify.ts              — wrap web-bot-auth verify(); resolver checks keyid against the
                             directory / local trust store; returns a structured verdict
    problem.ts             — application/problem+json helper
keys/
  lab-directory.jwk.json   — DEMO: lab signing key (pub+priv), in the directory
  demo-agent.jwk.json      — DEMO: visiting-agent key (pub+priv), in the directory (trusted)
  untrusted-agent.jwk.json — DEMO: key NOT in the directory (unknown-key scenario)
reference/
  README.md                — end-to-end walkthrough for a human or a coding assistant
  sign-request.mjs         — standalone Node client-side signer; prints curl or --send
scripts/
  gen-keys.mjs             — generate fresh Ed25519 JWK pairs (production / rotation)
```

## Key implementation notes

- **`functions/lib/verify.ts`** — resolver resolves keyid **only** from the fetched
  directory / local trust store (never trust the candidate). Validate `created`/`expires`
  with clock skew. Typed reason on every failure path: `unsigned` · `unknown-key` ·
  (later) `expired` · `signature-mismatch`.
- **`functions/api/sign.ts`** — signs with the **request's own origin** as `@authority` so
  the same-origin verifier recomputes the same base. `Signature-Agent` = the lab origin (its
  directory is this lab's own well-known endpoint — self-contained but shows the real
  fetch-and-trust path). Loud DEMO/TEST-AID banner in the JSON response.
- **Browser bundle** — one esbuild step (`npm run build`) emits `public/assets/agent-sign.js`
  from `web-bot-auth`. Pages build command: `npm ci && npm run build`. Keeps the lab
  self-contained (no CDN import at runtime).
- **Directory self-signing** (`tag="http-message-signatures-directory"`) — nice-to-have; if
  `web-bot-auth` `sign()` won't override the tag, drop to `http-message-sig` or note the gap.
- **`_middleware.ts`** — noindex header on every response, static and API.
- **Identities** — seed the directory with a couple of named demo agents ("ElipseBot /
  ElevIQ Lab", plus stand-ins labelled like real operators for the walkthrough). Be clear on
  the page these are lab demo keys, not the operators' real keys.

## What the user does (outside this scaffold)

1. Create empty **private** GitHub repo `jungmats/eleviq-lab`.
2. In `/Users/majung/Code/eleviq-lab`: `git init && git add -A && git commit`, then
   `git remote add origin … && git push -u origin main`. (User owns git — I scaffold only.)
3. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → `eleviq-lab`.
   Build: preset **None**, build command `npm ci && npm run build`, output dir `public`.
4. No secrets to configure in v1. `eleviq-lab.pages.dev` goes live.

## Verification (end-to-end)

Local — `npm install && npm run build && npx wrangler pages dev`, visit `http://localhost:8788`:
- Landing page renders in ElevIQ styling; Identify links to the live demo, others "coming".
- Demo 1: `valid` → ✅ VERIFIED + full price list; `unsigned` → ⛔ REFUSED + teaser +
  problem+json; `unknown-key` → ⚠️ REJECTED (untrusted key).
- `curl -s localhost:8788/.well-known/http-message-signatures-directory | jq` → keys, with
  `Content-Type: application/http-message-signatures-directory+json`.
- `node reference/sign-request.mjs --url http://localhost:8788/api/identity/price-list --send`
  → 200 + full list. Plain `curl` (no signature) → 401 + problem+json.
- `curl -sI` any URL shows `X-Robots-Tag: noindex, nofollow`.

Deployed (after the user connects Pages): repeat the curl / reference-script checks against
`https://eleviq-lab.pages.dev`.

## Later (not this plan)

- Scenarios `expired` + `tampered`.
- Demo 2 — Decide: policy engine, 403/402, robots.txt Content Signals + RSL "stated vs
  enforced" contrast.
- Demo 3 — Charge: Pay Per Crawl walkthrough + real x402 (testnet USDC on Base).
- Demo 4 — Measure: attribution dashboard (Workers Analytics Engine, AI-referral tracking).
- MCP endpoint (`fetch_as_agent`), custom domain `lab.eleviq.solutions`, DNS move to Cloudflare.
