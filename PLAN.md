# ElevIQ Lab — Demo 4 (Charge)

**Status (2026-09-15): deployed and live at `https://lab.eleviq.solutions/charge/`.**
`GET /api/charge/report`. A real x402 (HTTP 402) payment flow: no X-PAYMENT
header → `402` + price; a genuine signed-and-settled payment → `200` +
resource + on-chain proof. Runs on Base Sepolia (free testnet) with testnet
USDC — nothing of real value moves. All three scenarios verified against
production with real settlement, not just local `wrangler dev` — see below.

**Funding the two wallets was the hardest part of this build, not the code.**
Circle's faucet (`faucet.circle.com`) funded the agent payer with USDC in one
try — it's public/permissionless, no anti-bot gate. Getting the relayer its
testnet ETH (for gas) took five attempts: Alchemy's and QuickNode's faucets
both advertised "no mainnet balance required" but rejected the fresh address
anyway; Coinbase's CDP Portal faucet URL from its own docs 404'd because the
dashboard now scopes routes under a per-account `entity_...` id the docs
don't reflect. What actually worked: sending a couple of real dollars of ETH
to the relayer on Base mainnet first, which satisfied every faucet's
anti-sybil check afterward. Worth remembering for next time this lab needs a
fresh testnet wallet funded.

**Real bug found and fixed post-funding, caught by testing against
production with actual money-equivalent value at stake, not by re-reading
the code:** the first live payment attempt failed with a viem error showing
`eth_sendTransaction` instead of the expected `eth_sendRawTransaction` —
meaning the relayer's settlement call was asking the public RPC node itself
to sign, which it obviously can't ("unknown account"). Cause:
`verifyPayment()` passed the relayer's bare **address** (a string) into
`simulateContract()`'s `account` field instead of the full signing account
object; `simulateContract`'s returned `request.account` then carried that
address-only stub, and `settlePayment()`'s `writeContract(request)` used
*that* account instead of the wallet client's own properly-keyed one —
silently downgrading from local signing to the JSON-RPC signing path no
public node supports. Fixed by threading the real account object through
`verifyPayment()` end to end (`gateway/src/lib/x402.ts`,
`gateway/src/routes/charge.ts`); re-verified with a real settled transaction,
independently confirmed via `eth_getTransactionReceipt` (status success) and
fresh `balanceOf` reads on both wallets (not just trusting the response
body).

**Second bug, same session — a calibration one:** the "insufficient funds"
scenario's premium tier was priced at $5, sized for the ~$1–2 the user was
originally told to fund with. Circle's faucet actually drips a fixed 20 USDC
per request, so once real-funded, $5 was comfortably affordable and the
scenario silently *succeeded* instead of declining — caught by actually
running it live, not by inspecting the price constant. Repriced to $1,000
(`gateway/src/routes/charge.ts`), deliberately far above any plausible
faucet drip rather than tuned to one, so it can't silently drift back into
"affordable" again.

**Replay scenario verified against the real contract, not just the
gateway's response:** independently called `authorizationState(agent,
nonce)` on the live USDC contract after a replay attempt — confirmed `true`
(used) — and the real revert reason (`FiatTokenV2: authorization is used or
canceled`) matched exactly. EIP-3009's own on-chain nonce tracking, not
something this gateway re-implements.

**Copy revision, same day, from user feedback on the built page:** §1
shortened and de-weaseled (cut rhetorical framing and padding, four plain
sentences); the wallet-key callout rewritten around its actual purpose
(normally you'd never publish a private key — here's why this one is, and
what it lets a visitor actually do with it) instead of an operational aside
about "topped up"; §4 B replaced a vague reference to `assets/charge.js`
with an actual runnable guide — new `docs/reference/charge-pay.mjs`
(~50 lines, mirrors `sign-request.mjs`'s exact convention: `mkdir` / `npm
install` / `curl -O` / `node`), tested against both local and production
gateways before being linked.

**Facilitator decision (agreed with the user before building):** self-hosted,
not Coinbase's CDP-hosted one. x402 is explicitly permissionless — "anyone
can run a facilitator" — so the gateway itself plays both merchant and
facilitator: `gateway/src/lib/x402.ts` verifies the EIP-712 signature and
dry-runs the settlement via `eth_call` (free, catches insufficient funds and
reused nonces before spending any gas), then actually submits it if that
dry-run succeeds. Avoids a dependency on a third-party account this demo
doesn't need. One wallet plays both the facilitator's relayer (submits the
tx, pays gas) and the merchant's `payTo` (receives payment) —
`scripts/gen-charge-keys.mjs` generates it; private key is
`CHARGE_RELAYER_KEY`, a Cloudflare secret, never committed.

**On-chain facts verified directly against the contract, not copied from a
doc** — this mattered: real x402 integrations have shipped broken because
they assumed USDC's EIP-712 domain name is `"USDC"` when a given deployment
actually reports `"USD Coin"` (a mismatched domain silently fails every
signature). Called `name()`/`version()`/`decimals()` on Base Sepolia's real
USDC contract (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`) over its public
RPC before writing any code: `name="USDC"`, `version="2"`, `decimals=6` —
confirmed, not assumed.

**Two wallets, same "publish it on purpose" convention as Demo 1's
demo-agent key:** the demo PAYER wallet's private key is committed and
published (`gateway/keys/charge-agent.json` → `docs/reference/`) so anyone
can play the paying agent — it's testnet-worthless, so there's no reason to
guard it. The relayer/payTo wallet's key is the one that's actually kept
secret, mirroring how a real deployment would.

**Three scenarios**, same fixed-choice shape as Demos 1–2: pay the real
price (full 402 → sign → settle → 200 round trip); request a price
deliberately set above what the demo wallet is funded to (a genuine
`insufficient funds` on-chain decline, not scripted); replay an already-used
payment (resent verbatim — rejected by EIP-3009's own on-chain nonce
tracking, the same real replay protection Demo 1 and Demo 3 rely on, not
something this gateway re-implements).

**Verified locally (real Base Sepolia calls throughout, no mocking):** a
signed payment for an unfunded wallet correctly reached the real contract
and came back with its actual revert reason (`ERC20: transfer amount
exceeds balance`) — proving signature recovery, EIP-712 domain match, and
the on-chain dry-run all work, all before any wallet is funded. Full page
verified in headless Chromium: live balance panel, live 402 quote panel,
the two-step exchange render, verdict/log — screenshotted.

**Deployed and verified live (2026-09-15):** D1 migration + `wrangler secret
put CHARGE_RELAYER_KEY` + `npm run deploy:gateway`, all against production.
All three scenarios re-run against the real deployed gateway after funding
and after the two bugs above were fixed — pay (real `200`, tx independently
confirmed via `eth_getTransactionReceipt` + fresh `balanceOf` reads),
insufficient-funds (real decline at the new $1,000 price), and replay (real
decline, confirmed via `authorizationState`). The live public page itself
re-verified in headless Chromium against `lab.eleviq.solutions/charge/` —
not just `wrangler dev` — real balances, real `PAID · 200` verdict, real
settled panel.

**Files touched:** `gateway/src/lib/x402.ts` + `routes/charge.ts` (new),
`gateway/src/lib/log.ts` + `schema.sql` (new charge_* columns),
`gateway/src/lib/env.ts` + `wrangler.toml` (`CHARGE_RELAYER_KEY`),
`gateway/src/lib/http.ts` (`X-PAYMENT` CORS allow-header,
`X-PAYMENT-RESPONSE` expose-header), `gateway/src/index.ts` (routing,
`VERSION` bump), `scripts/gen-charge-keys.mjs` + `gateway/keys/charge-agent.json`
(new), `build/charge-sign.entry.js` + `build/bundle.mjs` (viem browser
bundle + key publishing), `docs/charge/index.html` + `docs/assets/charge.js`
+ `docs/reference/charge-pay.mjs` (new), `docs/lab.css` (balance table +
multi-step exchange styles), `docs/index.html` (landing card flipped to
live, reframed around "how does an agent pay" per user feedback — no
cross-references to other demos, no Pay Per Crawl mention), `package.json`
(`viem` dependency).

# ElevIQ Lab — Demo 3 (Delegate)

Built 2026-09-14, simulated version: `/delegate/`, `POST
/api/delegate/request-code` + `GET /api/delegate/account`. Proves an agent is
acting for a specific email via a one-time code — code is returned in the API
response (not emailed) for now, clearly labeled DEMO. Real email sending +
rate-limiting is a deliberate later step (first real secret this lab needs).
New KV (`DELEGATION_CODES`) + two `access_log` columns (`acting_for`,
`delegation_outcome`). Deployed 2026-09-15, verified in production.

Follow-ups from user testing: replaced the 3 scenario radios with a free-text
code input (type the real one, a modified one, or leave it blank). Reused
codes now say "already used" (a kept "used" marker) instead of the same
"invalid" message as a wrong code — clearer, and both are real single-use
enforcement either way.

# ElevIQ Lab — Demo 2 (Decide)

**Status (2026-09-14): deployed and live at `https://lab.eleviq.solutions/decide/`.**
All three scenarios verified against production (not just local `wrangler
dev`); the three D1 migrations applied to the remote `eleviq-lab-log`
database; Demo 4's `/measure/` dashboard confirmed unaffected by the schema
change. Demo 1 checked whether a request carries a valid
cryptographic signature. Demo 2 answers a different question: given a
verified request, is it actually allowed to do a certain action, or access a
certain resource?

**The story.** A resource owner publishes a policy for one specific resource
in an RSL (Really Simple Licensing) license file. The demo's point:
**declaring a policy and enforcing one are different things.** A visitor picks
what purpose the (already-trusted) agent declares and watches a real, live
gateway decision — not page copy — prove that publishing a policy protects
nothing by itself; only enforcement does.

robots.txt Content Signals were considered and **removed** after the user
caught that they don't fit: Content Signals can only state a policy for an
entire site, never for one resource — so they had nothing real to contribute
to a demo about whether *this* resource allows *this* use. RSL's `<content
url="...">` can target exactly that, and does; it's now the demo's only
"stated" artifact. See "rounds of copy review" below for how this was found.

**Decisions made (agreed with the user before building):**
- No payment/402 preview in this demo — strictly allow/deny. Charge is its
  own demo's territory.
- A new, self-contained protected resource — "Q3 competitive deal-margin
  notes" (`GET /api/decide/deal-notes`) — not Demo 1's price list.
- Identity is fixed here: every request signs with the same trusted
  demo-agent key as Demo 1. The only varying axis is **declared purpose**,
  sent as a genuine `X-Agent-Purpose` request header — this lab's own
  convention (not a ratified standard), reusing RSL's own usage vocabulary
  (`search` / `ai-input` / `ai-train`).
- Exactly 3 scenarios: `ai-input` (stated-permitted) → `200`; `ai-train`
  (stated-prohibited) → live `403`, same trusted identity as the allowed
  case, only the declared purpose differs; no purpose declared → `403`
  default-deny (`purpose-undeclared`) — this gateway's own design choice: not
  knowing what a request intends is not treated as permission to find out.
- **Single source of truth**: one policy data object (`gateway/src/lib/
  policy.ts`) drives the served `/.well-known/rsl.xml` file *and* the
  enforcement decision — `decide()` parses the exact XML the gateway itself
  serves, rather than reading the data object directly, so the decision is
  provably reading the same document a fetcher would receive. Stated and
  enforced can't drift apart by construction; the teaching point is that
  declaring doesn't enforce, not that the two disagree.
- RSL fidelity: a real, spec-shaped `<license>` XML document
  (`gateway/src/lib/rsl.ts`), built and parsed with genuine (if minimal) XML
  parsing (`fast-xml-parser`) — not a JSON stand-in. Narrow scope: only the
  `<permits>`/`<prohibits type="usage">` vocabulary this demo needs, not
  RSL's full surface (payment terms, other permission types, etc).
- No canonical path is mandated by the RSL spec for the license file itself;
  `/.well-known/rsl.xml` was chosen to match this gateway's existing
  `.well-known` convention (the Web Bot Auth key directory), and the page
  says so explicitly rather than implying the spec requires it.
- Parked for later, not built now: a reusable visual **policy editor**
  component (a form generating the robots.txt lines + RSL XML) — see "Later"
  below.

**Bug caught during verification, fixed before calling it done:** the RSL
parser (`gateway/src/lib/rsl.ts`) initially read `<permits type="usage">…
</permits>`'s text content as a plain string, but `fast-xml-parser` returns
`{ "@_type": "usage", "#text": "…" }` for any element that has both an
attribute and text — so `prohibits` silently parsed to an empty array and
**every declared purpose, including `ai-train`, was allowed**. Caught by
testing the real `ai-train` request end-to-end (not by re-reading the code) —
the `200` response instead of the expected `403` was the tell. Fixed by
reading through `#text` when present; re-verified `ai-train` → `403
purpose-prohibited` afterward.

**Verified (local, headless Chromium + curl against `wrangler dev`), not just
that the markup renders:**
- `GET /.well-known/rsl.xml` → well-formed RSL XML, fetched and displayed
  live in the page's own "Stated vs enforced" panel (not hardcoded page
  text).
- Signed `ai-input` → `200` + full deal notes. Signed `ai-train` (same key,
  fresh signature) → `403 purpose-prohibited`, `verified` facts still present
  (identity succeeded; only policy denied). No `X-Agent-Purpose` header at
  all → `403 purpose-undeclared`. All three reproduced in a real headless
  browser via the actual console UI (`?send=ai-input|ai-train|undeclared`),
  correct verdict color/status/facts each time, screenshotted in both light
  and dark mode.
- Nonce replay protection (built for Demo 1) applies here too, unprompted —
  replaying the same signed request across scenarios correctly hit `401
  replayed` on reuse, confirming each scenario needs its own fresh signature
  (expected behavior, not a bug).
- CORS preflight (`OPTIONS` with `Access-Control-Request-Headers:
  x-agent-purpose`) returns the new header in `access-control-allow-headers`
  — confirmed before relying on the browser console to prove it.
- `access_log`'s three new nullable columns (`purpose`, `policy_decision`,
  `policy_reason`) added via the same inline-`ALTER TABLE` convention as
  `trust_tier`; Demo 1 rows unaffected (columns read `null`).

**Files touched:** `gateway/src/lib/policy.ts` + `rsl.ts` (new),
`gateway/src/routes/deal-notes.ts` + `license.ts` (new),
`gateway/src/index.ts` (routing, `VERSION` bump, endpoint lists),
`gateway/src/lib/http.ts` (`X-Agent-Purpose` CORS allow-header, new `text()`
helper), `gateway/src/lib/log.ts` + `gateway/schema.sql` (new columns),
`docs/decide/index.html` + `docs/assets/decide.js` (new), `docs/index.html`
(landing card flipped to live), `package.json` (`fast-xml-parser` dependency).

**Two rounds of copy review from the user, applied:** resource renamed from
"Q3 competitive deal-margin notes" to plainer **Q3 sales notes** (unbolded);
jargon and fuzzy phrasing cut throughout §1–§3 (no more "declaring is
advisory, only enforcement is real"-style sentences); RSL spelled out
(Really Simple Licensing) with a one-line explanation before first use;
Content Signals explained inline instead of assumed. Second round caught two
real defects: the "Content Signals" link
(`developers.cloudflare.com/bots/additional-configurations/content-signals/`)
404s — replaced with the canonical `contentsignals.org`; and the demo's own
`/robots.txt` used a paraphrased explanation instead of the real Content
Signals Policy boilerplate (verbatim, CC0-licensed text that real sites
like `niaaa.nih.gov` actually serve) — replaced with the verbatim canonical
text so the fixture reads like a genuine implementation, not an
approximation of one. Third round: "publishing doesn't stop anything"
reworded to "publishing a policy doesn't mean it's respected"; the "is this
really who it says it is?" framing (a rhetorical question, not a concrete
claim) replaced with a plain statement of what Demo 1 actually checks
(a valid cryptographic signature); and a real granularity gap surfaced by
the user — robots.txt/Content Signals states a policy for the whole site, it
cannot target one resource, while RSL's `<content url="…">` can and does —
called out explicitly in both §1 and the §3 fetched-panel captions.

**Fourth round: the user asked the obvious follow-up** — if robots.txt can't
target this resource and the enforcement logic (`decide()`) only ever read
the RSL file anyway, why include robots.txt in this demo at all? It was dead
weight: displayed on the page but never actually consulted by the decision
it was supposed to help explain. Rather than patch around that, **removed
robots.txt entirely** — route (`gateway/src/routes/robots.ts`), fixture
(`robotsTxtFor()`, the canonical Content Signals boilerplate added in round
2), and every page/copy mention. Demo 2 is now built entirely around RSL,
the one mechanism that actually targets this resource. Confirmed RSL's own
vocabulary (`search`/`ai-input`/`ai-train`) already supplies everything the
`X-Agent-Purpose` header needed Content Signals for, so nothing else had to
change to fill the gap.

**Deployed (2026-09-14), on the user's go-ahead:** `npm run deploy:gateway` +
the three `ALTER TABLE` migrations against remote D1. Along the way, found
(not a bug in our code): `GET /robots.txt` on `eleviq-lab-gateway.
gateway-worker.workers.dev` returns Cloudflare's own platform-level default
robots.txt (their real Managed robots.txt / Content Signals feature for
`*.workers.dev`), intercepting that exact path before it ever reaches this
Worker — confirmed by checking that every other path, including genuinely
unmatched ones, correctly reflects the current deployed code. Irrelevant to
Demo 2 now that it doesn't rely on `/robots.txt` at all, and a fitting
real-world footnote to round 4's removal: even if we wanted to serve our own
robots.txt from this Worker, this shared domain wouldn't reliably let us.

**Fifth round — the user asked the natural next question: what stops an
agent from lying about its declared purpose?** Answer, stated plainly:
nothing does, structurally — `X-Agent-Purpose` (like RSL, like Content
Signals) is a self-report at request time; there's no way to cryptographically
bind a declared intent to what actually happens to the data after it leaves
the server. What identity (Demo 1) adds is not prevention but
**accountability**: a lie isn't anonymous, so it's traceable after the fact
even though it can't be blocked in the moment. Added a short, one-sentence
disclaimer to the end of §3 saying exactly this — same honesty convention as
Demo 1's "a UA that deliberately spoofs a real browser is fundamentally
undetectable" admission, rather than let the page imply the policy engine
solves trust. Broader options discussed but not built: behavioral/pattern
detection via the access-log dashboard (declared purpose vs. observed crawl
pattern — a natural Demo 4 extension), and content watermarking/canaries for
after-the-fact proof of misuse.

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

**Landing page (`docs/index.html`): Measure card flipped to "Live."** Was
"Coming" throughout the build (see the earlier reverted attempt, noted
above — "the dashboard belongs to demo 1"); now that both dashboards exist
and are verified, the card carries two links instead of one demo link:
`measure/` (Demo 1's own access log, primary button) and
`https://insights.eleviq.solutions/` (real site traffic, secondary button,
labeled "Behind login"), each with a one-line description of what it shows.
New `.measure-link` styles in `lab.css`. Verified: `measure/` → `200`,
`insights.eleviq.solutions` → `302` to the real Access login page — not
just checking the markup renders.
**Two rendering bugs the user caught on a local `file://` open, fixed and
actually verified in a real headless browser (Playwright/Chromium
installed for this) rather than by re-reading markup:** (1) the secondary
button had no rounded corners, was underlined, and overlapped the line
above — cause: `a.button-secondary` in `styles.css` is a *modifier* class
meant to be combined with `button` (`class="button button-secondary"`),
not used standalone; it only overrides color/border/background and relies
on `a.button` for `display: inline-block`, `border-radius`, `text-decoration:
none`. Fixed by adding the base class. (2) the button's background still
read as "white" after that fix — confirmed via computed-style inspection
this was `rgba(0,0,0,0)` (correctly transparent, the CSS was right), just
the white `.section` card showing through, identical to the rest of the
card — a legitimate but visually flat "outline button" look sitting right
under a solid one. Gave it a subtle fill (`var(--code-bg)`) scoped to
`.measure-link .button-secondary` only, so the site's reusable
`button-secondary` style elsewhere is untouched. Screenshotted both light
and dark mode to confirm.

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

**Third fix, same session — real root cause, not cosmetic:** the user asked
why `/openapi.json` (not a page on the site) showed up at all. Cause:
`site-logger` only checked `content-type`, and GitHub Pages serves its 404
page as `text/html` too — so every guessed/probed URL (bots and ordinary
internet vulnerability scanners alike, hitting `/openapi.json`,
`/.well-known/agent-card.json`, `/.git/config`, `/auth.md`, `/api/.env`, …)
was logged identically to a real page view. Checked all 107 distinct logged
paths' live status: **102 were 404s, only 5 were real pages** — of 219
total rows, 147 were noise, 72 real. Fixed at the source
(`site-logger/src/index.ts`: `response.ok` added to the logging condition,
alongside the existing `content-type` check) and deployed — verified live
with a paired test (a guessed-URL 404 → not logged; a real page hit in the
same batch → logged normally, total rows +1 not +2). Historical noise
cleaned from production D1 with the user running the confirmed DELETE
themselves (blocked for me by the sandbox's destructive-write classifier
even after the user's explicit go-ahead) — verified after: 73 rows left,
all under the 5 real paths, zero 404-noise remaining.

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

Demo 2 — Decide is now built too (see the top of this file). Pipeline is now
6 stages (see top); next up is Demo 3 — Delegate.

## Context

`eleviq.solutions` markets ElevIQ's AI agent-readiness and monetization consulting.
`technologies.html` *describes* the relevant stack (Web Bot Auth, robots.txt, RSL, HTTP 402,
x402, Pay Per Crawl, Bot Analytics) but shows nothing working.

**ElevIQ Lab** is an isolated playground (not indexed, link-only) with working, end-to-end
demonstrations of the problems agent-readiness engagements surface — and a reference
implementation clean enough to point a coding assistant at.

Full pipeline (2026-09-14, expanded to 6 stages): **Identify → Decide →
Delegate → Charge → Measure → Sustain**. Delegate and Sustain added per user
request — Delegate = agent acting on behalf of a user, proven via an email
one-time code (not OAuth, for now); Sustain = the former "post-ad
monetization" open problem, now its own tile, scope tbd.
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
- Demo 3 — Delegate: agent acting for a user, email one-time code. Not started.
- Demo 4 — Charge: Pay Per Crawl walkthrough + real x402 (testnet USDC on Base).
- Demo 6 — Sustain: post-ad monetization, scope tbd (may be several demos).
- A reusable visual **policy editor** component — a form generating the
  robots.txt Content-Signal lines + RSL license XML from structured input
  (which uses are allowed, which need payment, which are refused). Raised
  while designing Demo 2; genuinely useful for ElevIQ's client work, not
  needed for the demo itself (which uses one hand-authored policy fixture).
- MCP endpoint (`fetch_as_agent`), custom domain `lab.eleviq.solutions`, DNS move to Cloudflare.
