# ElevIQ Lab — Demo 1 (Identify) + Demo 4 (Measure: part A lab, part B site)

**eleviq.solutions DNS migration: done.** Nameservers on Cloudflare, mail
(MX/SPF/both DKIM selectors/DMARC) verified intact, `intake` CNAME gap found
and fixed (was silently caught by the `*` wildcard, resolving to GitHub Pages
instead of Vercel — fixed with an explicit record). Apex + `www` now
proxied (orange-cloud); `lab` and `compliance` deliberately left DNS-only,
confirmed unaffected.

**Demo 4, Part B (`site-logger/`, eleviq.solutions traffic): built, tested,
and LIVE.** A transparent passthrough Worker — fetches the real GitHub
Pages origin via `cf.resolveOverride` (avoids looping back through its own
route) and returns it byte-for-byte unchanged; the only side effect is an
async, fire-and-forget log entry for HTML responses (path, visitor name +
category, AI-assistant referral via `Referer`, Cloudflare's own bot-category
signal, country — no cookies, no visitor id, no raw IP). Separate D1
database (`eleviq-site-log`), separate from the lab's. `wrangler.toml`'s
`[[routes]]` block is now live (`eleviq.solutions/*`, `www.eleviq.solutions/*`),
bound after explicit confirmation.

**Visitor classification rewritten around Cloudflare's own AI Crawl Control
taxonomy** (`lib/classify.ts`) — five categories instead of a flat bot/human
split, because the thing the user actually wants to see is attribution: did
a *person* read this page (`human`), did a person ask an AI assistant to
fetch it live right now (`agent` — ChatGPT-User, Claude-User, Perplexity-User,
MistralAI-User), or is it background crawling that isn't tied to any one
person (`search` — Googlebot, Bingbot, OAI-SearchBot, …; `training` — GPTBot,
ClaudeBot, CCBot, …)? A fifth bucket, `unrecognized`, catches anything that
doesn't match a known signature and doesn't look like a real browser UA
either (no `Mozilla/5.0` + engine token) — this is where home-grown /
unlabelled agents land, on the honest caveat that a UA that deliberately
spoofs a real browser is fundamentally undetectable by this method. All five
categories are logged for now, deliberately — nothing is filtered out yet
(that's a one-line `WHERE` clause later, once there's real data to decide
from, per explicit instruction).
**Verified live against production, one isolated request per category (unique
query string + delay before reading D1, to avoid rapid-fire ordering noise):**
ChatGPT-User → `agent`, GPTBot → `training`, PerplexityBot → `search`,
`python-requests` UA → `unrecognized`, a real browser UA → `human`. All five
matched exactly.

**Dashboard (`insights/`) built, deployed to its workers.dev URL, NOT yet
bound to `insights.eleviq.solutions` — pending Cloudflare Access setup.**
New standalone Worker (separate from `site-logger`, which only writes) —
reads the same `eleviq-site-log` D1 database, read-only. One JSON endpoint
(`GET /api/insights`, optional `?path=<exact pathname>`) + a static page
(`public/`, served via Workers Static Assets) that is **one HTML/JS file
driving two modes off that query param** — Overview (all pages: stat row,
5-category stacked-bar trend chart, top-pages table) and per-page (same
stats/chart/events, scoped, top-pages table hidden — exact match, not a
prefix). Raw events collapsed by default in a `<details>`, same convention
as Part A. Chart palette: the dataviz skill's default 5-color slots
(human/agent/search/training/unrecognized, fixed order), validated with
`validate_palette.js` — passes in both modes; light mode carries a contrast
WARN satisfied by the legend + table being present, per the skill's relief
rule.
**Bug caught by testing against the real remote D1, fixed before calling it
done:** 155 pre-migration rows (logged before `visitor_category` existed)
came back as SQL `NULL`, which silently broke the stat breakdown's sum
(pieces didn't add up to the total) and would have rendered "null" in the
raw table. Fixed with `COALESCE(visitor_category, 'uncategorized')` in every
query in `insights/src/routes/insights.ts`; the dashboard surfaces it as its
own labeled stat column with an explanatory hint, excluded from the trend
chart (it isn't a real category, just pre-upgrade noise) — verified the
by-category counts now sum exactly to the total, for both Overview and a
per-page filter.
Shared visual language with the rest of the lab (`styles.css` + `lab.css`,
copied into `insights/public/` since this Worker doesn't share a build with
the GitHub Pages site — kept in sync by hand, not by tooling, noted in the
files' own comments).
**Cloudflare Access: done, live, verified.** Self-hosted Access application
on `insights.eleviq.solutions` (Zero Trust dashboard — outside this
session's wrangler OAuth scope, set up by the user), identity provider
"Cloudflare" (the built-in default — email one-time-PIN, no separate IdP
setup needed), policy allowing the user's email only. Bound via Workers
**Custom Domains** (`custom_domain = true` in `insights/wrangler.toml`, not
a `zone_name` route — this is a brand-new subdomain with no prior DNS
record, so Custom Domains provisions the DNS + TLS itself, unlike
site-logger's `zone_name` route which had to preserve an existing
GitHub Pages record). **Verified live:** an unauthenticated request to
`https://insights.eleviq.solutions/` returns `302` to
`nameless-wind-f7be.cloudflareaccess.com/cdn-cgi/access/login/…` — a genuine
Access login redirect, not the dashboard content. Demo 4 (Measure) — both
parts — is now fully built, deployed, and access-controlled where it needs
to be.

**Two real fixes from the user's first look at real data:**
- **"80% unrecognized" turned out to be a labeling confusion, not real
  traffic composition.** What the user saw as `visitor: human` next to
  `unrecognized` was actually `human` next to **`uncategorized`** — the
  155 pre-migration rows (logged before `visitor_category` existed),
  which read too similarly to `unrecognized` at a glance. Since those
  rows already stored a deterministic `visitor` name (`human`, `GPTBot`,
  `ClaudeBot`), backfilled `visitor_category` from it directly —
  `UPDATE page_views SET visitor_category = CASE visitor WHEN 'human'
  THEN 'human' WHEN 'GPTBot' THEN 'training' WHEN 'ClaudeBot' THEN
  'training' ELSE visitor_category END WHERE visitor_category IS NULL`
  — run against production after explicit confirmation (`changes: 155`,
  matching exactly). No "uncategorized" bucket left; real breakdown is
  `human: 177, unrecognized: 5, training: 4, search: 2, agent: 2` (out
  of 190) — unrecognized is ~2.6%, not 80%.
- **A page with only 1 visit (`/services/ai-agent-readiness.html`) wasn't
  showing up anywhere** — real data (confirmed logged, 1 row), just
  outside both the top-15-by-traffic table and the last-100-raw-events
  window once ~100 distinct paths accumulated, many from ordinary
  internet vulnerability-scanner background noise
  (`/wp-includes/…`, `/.env`, `/.git/config`, `/auth.md` — normal for any
  newly-proxied domain, not a sign of compromise). Fixed with a "jump to
  a page" input on the Overview (`insights/public/index.html` +
  `insights.js`'s `setupPathJump()`) that navigates straight to
  `?path=<exact pathname>` — any logged page is reachable regardless of
  its traffic volume or recency.

# ElevIQ Lab — Demo 1 (Identify) + Demo 4 part A (Measure)

**Status (2026-09-11): Demo 1 deployed and live.** `lab.eleviq.solutions`
(GitHub Pages) + `eleviq-lab-gateway.gateway-worker.workers.dev` (Cloudflare
Worker), verified end-to-end in a real browser and via all four external test
paths.

**Demo 4, Part A (agent access dashboard): built, deployed, first-review fixes
applied.** `gateway/src/routes/log.ts` (`GET /api/log` — summary +
day-bucketed outcome counts + last 100 rows, from `access_log`) +
`docs/measure/` (stat table, stacked bar chart, recent-requests table).
**This is a sub-view of Demo 1, not its own landing-page pipeline stage** —
landing page's Measure card reverted to "Coming"; linked instead from
`identity/index.html` §2, right by the client-side request log ("that list
disappears on refresh; the real log doesn't"). Fixes from first review: `§1
The problem` section cut (unnecessary once framed as Demo 1's own log); stat
tiles rebuilt as an actual `<table>` (was mis-rendering as run-together text);
chart segments were rendering solid black — SVG `fill="var(...)"` as a bare
attribute doesn't reliably resolve CSS custom properties, fixed by using
`style="fill:var(...)"` instead (legend swatches were already using `style=`,
which is why only the bars were affected); recent-requests table now sits in
a `<details>`, collapsed by default, with a live count. Verified against the
real remote D1 data (30 rows, including the ChatGPT Work hit) after each fix.
**Part A is public/unprotected on purpose** — no PII in the data; a real
deployment would gate a path like this with Cloudflare Access once the
gateway has a custom domain, not app-level auth (see `measure/index.html`
§2). Chart palette validated with the dataviz skill's `validate_palette.js`
— the site's existing `--ok`/`--bad`/`--warn` trio fails as an adjacent
categorical set, so the chart uses its own 4-color palette
(`--cat-own/registry/unsigned/other` in `lab.css`) from the skill's default
ordering instead.

**Demo 4, Part B (AI-referral / agent-vs-human attribution on
`eleviq.solutions` itself): blocked on the DNS migration**, in progress —
nameservers switched at Porkbun to Cloudflare's, not yet propagated. Not
started otherwise.

Since initial deploy:
- **Identity honesty fix:** trust store collapsed to one "ElevIQ Lab demo
  agent" key (was 3 keys impersonating OpenAI/Anthropic/Perplexity). The
  console's claimed-identity control is now a free-text input, defaulting to
  `ElevIQ Lab demo agent` — an exact match to what actually verifies, so the
  default state shows no mismatch; edit it to anything else and watch it
  diverge. Signing always uses the one demo key, so "Claimed" and "Verified
  as" can visibly differ once you do. Added §3 "What makes a real agent's key
  trustworthy" (secret key + vetted registry) and the ⚠️ claim-mismatch flag.
- **Access log:** D1 table `access_log` (`gateway/schema.sql`), one row per
  request to `/api/identity/price-list` with outcome + identity. Foundation
  for Demo 4; no dashboard yet, inspect via `wrangler d1 execute`.
- **`/api/debug/cf`** — diagnostic endpoint exposing Cloudflare's own heuristic
  edge signals (`verifiedBotCategory` etc.) for the caller's own request.
  Confirmed real signal only for "ChatGPT Work"; confirmed the presence of a
  genuine, matching Web Bot Auth signature from it too (see Tier 2 below).
  Not used for any trust decision.
- **Tier 2 built and deployed** (design below, now implemented):
  `gateway/src/lib/registry.ts` (allow-list, one entry: `chatgpt.com`),
  `gateway/src/lib/external-directory.ts` (live fetch, in-memory cache,
  fail-closed, matches by recomputed thumbprint not raw `kid`), `verify.ts`
  extended to try Tier 1 then Tier 2, `trust_tier` column added to
  `access_log` (migrated on both local and remote D1).
  **Proved live**, not just tested: replayed the real captured ChatGPT Work
  signature from `/api/debug/cf` against `/api/identity/price-list` →
  genuine `200`, `trust_tier: "registry:https://chatgpt.com"`. Also proved
  the rejection path — a request claiming `Signature-Agent: chatgpt.com` but
  signed with an untrusted key → correctly `401 unknown-key`, only after the
  gateway actually checked chatgpt.com's real directory and found no match.
  **Fix found along the way:** `maxAge` was `600`s (10 min), rejecting the
  real signature's 1-hour `created`→`expires` window before it ever reached
  the resolver — raised to `3600`s to match observed real-world practice.
  `identity/index.html` §3 updated to state this precisely: confirmed with
  ChatGPT Work, not confirmed for consumer ChatGPT.
- **Nonce replay protection built and deployed**, closing the gap the
  captured-signature replay exposed. `gateway/src/lib/nonce.ts`: after
  `verify()` already confirms a signature is genuine and trusted, claim its
  nonce in a new KV namespace (`NONCES`, TTL = seconds until that signature's
  own `expires` — no cleanup job needed). First use succeeds; a second use of
  the identical signature → `401`, `reason: "replayed"`. A missing nonce
  (allowed by spec) just skips this specific check rather than failing the
  request. **Proved live**: signed one request via `/api/sign`, replayed the
  same headers twice — first `200`, second `401 replayed`; two independently
  signed requests each still `200` (no false positives).
- **Open, not yet decided:** a visible (non-blocking) "claim doesn't match
  verified identity" flag in the console verdict when Claimed ≠ Verified for
  a *valid* signature — proposed, not built, pending confirmation. Distinct
  from replay: this is about the claim never being signed data at all, not
  about reuse.

Next: Demo 2 — Decide.

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
  src/lib/keys.ts            trust store: ONE "ElevIQ Lab demo agent" key; keyid → agent metadata; directory list
  src/lib/verify.ts          wrap web-bot-auth verify(); resolver checks keyid vs trust store; typed verdict
  src/lib/http.ts            json() / problem() (application/problem+json) / CORS helpers
  src/lib/log.ts             logAccess() — writes one row per request to D1 (fire-and-forget via ctx.waitUntil)
  keys/*.jwk.json            committed DEMO keypairs (demo-agent · untrusted-agent)
  schema.sql                 D1 access_log table
  wrangler.toml              includes the [[d1_databases]] binding (DB → eleviq-lab-log)
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

## Tier 2 — real operator trust (built and deployed, 2026-09-11)

### Why

Trust today is a single self-issued demo key — real, but self-vouched (see "What
makes a real agent's key trustworthy" in identity/index.html §3). The value of
Demo 1 is abstract as long as it can only ever verify itself. Tier 2 makes a
**genuinely third-party-signed request verify for real**, starting with OpenAI.

### What we confirmed first (2026-09-11), before designing this

- `https://chatgpt.com/.well-known/http-message-signatures-directory` is **live**:
  `{"keys":[{"crv":"Ed25519","kty":"OKP","x":"7F_3jDlxaquwh291MiACkcS3Opq88NksyHiakzS-Y1g",
  "kid":"otMqcjr17mGyruktGvJU8oojQTSMHlVm7uO-lrcqbdg","use":"sig","nbf":...,"exp":...}],
  "signature_agent":"https://chatgpt.com","purpose":"ai"}`.
  `operator.openai.com`, `anthropic.com`, `claude.ai`, `perplexity.ai` do **not**
  (yet) publish one — Web Bot Auth is brand new (W3C spec finalized May 2026) and
  scoped per *product* (ChatGPT Atlas/Operator, Claude in Chrome, Perplexity
  Browser), not per company domain, so the others likely exist at a different,
  unguessed host.
- **Captured a real example**, "ChatGPT Work" hitting `/api/debug/cf`:
  `Signature-Agent: "https://chatgpt.com"`,
  `Signature-Input: sig1=("@authority" "@method" "signature-agent");created=…;
  keyid="otMqcjr17mGyruktGvJU8oojQTSMHlVm7uO-lrcqbdg";alg="ed25519";expires=…;
  nonce="…";tag="web-bot-auth"`. **The keyid matches the live directory exactly.**
  Real, live, matching signature — this is not hypothetical.
- Registries exist (Cloudflare's canonical one:
  `https://assets.radar.cloudflare.com/bots/signature-agent-registry.txt`, a
  plain text list of directory URLs) but Cloudflare's own file is behind a JS
  challenge for non-browser fetches — not reliably fetchable from a Worker.
- Rejected the heuristic tier (`request.cf.verifiedBotCategory`) as a trust
  source — real but non-cryptographic, no non-repudiation, silently degrades.
  Kept only as a passive log field (see `/api/debug/cf`, already built).

### Decision: a small hardcoded allow-list, not a live registry fetch

Per discussion — start with one hardcoded entry (`chatgpt.com`) rather than
depending on Cloudflare's (currently unreachable) registry file. Extensible:
adding Anthropic/Perplexity later is one line, once they publish a directory.

```ts
// gateway/src/lib/registry.ts
interface RegistryEntry { origin: string; label: string; operator: string }

export const REGISTRY: RegistryEntry[] = [
  { origin: "https://chatgpt.com", label: "ChatGPT", operator: "OpenAI" },
];
```

### Verification flow (extends `gateway/src/lib/verify.ts`)

The resolver `web-bot-auth`'s `verify()` calls today only checks the local Tier
1 store. Extend it:

1. `candidate.keyid` in the local trust store (Tier 1, our own key)? → return
   that verifier, no network call. **Unchanged, existing behaviour.**
2. Else, is `candidate.signatureAgent.uri` an **exact string match** for an
   entry in `REGISTRY`? If not → reject (`unknown-key`), same as today.
   *(Exact match against our own fixed list — never fetch a URL taken from the
   request. This is what keeps step 3 safe from SSRF.)*
3. Fetch `${origin}/.well-known/http-message-signatures-directory` (short
   timeout via `AbortSignal.timeout(…)`, cap response size), through the
   Workers **Cache API** keyed by that URL (TTL ~10 min — don't fetch this on
   every request to a warm operator).
4. Find a JWK in the response matching `candidate.keyid`. Check its own
   `nbf`/`exp` (the *key's* validity window — separate from the signature's
   own `created`/`expires`, which `verify()` already checks).
5. Found + valid → `verifierFromJWK(jwk)`, `verify()` proceeds as normal
   (still actually checks the Ed25519 signature — step 2/3 only establish
   *which* key is allowed to be checked, they are not the check itself).
6. Any failure in 3–5 (fetch error, non-200, no matching key, expired key)
   → **fail closed**, reject as `unknown-key`. Never fail-open on a network hiccup.

### Logging

Add a `trust_tier` column to `access_log` (`"own"` | `"registry:<origin>"`) so
the log — and eventually the Demo 4 dashboard — can show real third-party
verifications distinctly from self-key ones.

### What's actually demoable

The console/reference script **cannot manufacture a passing Tier 2 request** —
we don't hold OpenAI's private key, deliberately. Two things ARE demoable:

- **The rejection case**, on demand, right now: sign a request claiming
  `Signature-Agent: "https://chatgpt.com"` with our OWN key (or no key) →
  gateway looks it up in the real live chatgpt.com directory → no match →
  correctly rejected. Proves the gateway isn't fooled by merely *claiming* to
  be a registered operator.
- **The acceptance case, live, on demand** — ask ChatGPT Work (confirmed
  capable, see above) to fetch the protected resource. A real pass, not
  staged. Best shown live in a walkthrough; the access log is the durable
  record afterwards.

### Files touched (implemented)

`gateway/src/lib/registry.ts` (new) · `gateway/src/lib/external-directory.ts`
(new) · `gateway/src/lib/verify.ts` (resolver, + `maxAge` fix) ·
`gateway/schema.sql` + `src/lib/log.ts` + `src/routes/price-list.ts`
(`trust_tier` column, migrated live) · `identity/index.html` §3 (states what's
confirmed — ChatGPT Work yes, consumer ChatGPT no).

## Later (not this plan)

- Scenarios `expired` + `tampered`.
- Demo 2 — Decide: policy engine, 403/402, robots.txt Content Signals + RSL "stated vs
  enforced" contrast.
- Demo 3 — Charge: Pay Per Crawl walkthrough + real x402 (testnet USDC on Base).
- Demo 4 — Measure: attribution dashboard (Workers Analytics Engine, AI-referral tracking).
- MCP endpoint (`fetch_as_agent`), custom domain `lab.eleviq.solutions`, DNS move to Cloudflare.
