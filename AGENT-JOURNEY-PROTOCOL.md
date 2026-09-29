# Agent Journey Protocol: concept, design and implementation plan

**Status (2026-09-29): phases 1–5 built and verified locally, not deployed.**
First target: a dedicated demo in ElevIQ Lab (`/journey/`), served by its
own Worker, with its own analytics dashboard. Second target: the same code
carved out as a module ElevIQ deploys and customizes for customers.
Build notes, deviations from this plan, and deploy steps: section 13.

"Agent Journey Protocol" is a working name for an ElevIQ profile that
composes existing standards (section 3). It is not a ratified standard, and
the demo page says so.

**Revision 2 changes:** dedicated Worker instead of routes on the existing
gateway; expanded intent envelope with constraints separated from decision
criteria; cancel call; dedicated analytics dashboard; standards alignment;
MCP options; cross-site journeys explained; decisions resolved.

---

## 1. The idea

A customer journey becomes an explicit, monitored entity for agents.

- A **journey** is a sequence of tool calls (steps) through which an agent
  changes state towards a clear end state: *achieved* or *not achieved*.
- An agent **starts** a journey and receives a `journey_id`. Every later call
  must carry it.
- A step is **accepted only** when the earlier steps it depends on are done
  **and** the agent supplies the information that step demands.
- The agent opens with an **intent declaration handshake**.
- The `journey_id` correlates every log line into one journey, so you see
  which journeys complete, which fail, at which step and why.
- Journeys are **bound to agent identity** when the agent signs, and can
  additionally be bound to a **user**.
- Steps act as structured intake. The goal is to capture enough to
  **reconstruct a plausible version of the user's original prompt**: who
  asked, for what, under which constraints, judged by which criteria.

---

## 2. What the lab already has

| Idea element | Already in the lab | Gap |
|---|---|---|
| Intent declaration | Demo 2's `X-Agent-Purpose` header, deny-by-default | One field only |
| Multi-step stateful flow | Demo 3: request-code, then account, KV state, single-use, TTL | Hard-coded, no journey id |
| Logging | D1 `access_log`, one row per request | Rows cannot be correlated |
| Agent identity | `checkIdentity()` in `gateway/src/lib/verify.ts`, own keys plus the ChatGPT Work registry | Not bound to a session |
| Configurable features | `site-logger/src/config.ts` feature toggles | Not used by the gateway |
| Dashboards | `/measure/` and `insights.eleviq.solutions` | No funnel or intent view |

The journey Worker reuses the identity and delegation code through adapters
rather than living inside the gateway (section 4.1).

---

## 3. Standards: what exists and how this relates

No existing standard covers the full idea: a **server** that enforces step
order, requires a declared intent per journey, and logs journeys as funnels.
Several standards cover parts of it. The recommendation is to align with
them wherever they fit, and keep the protocol name only for the combination.

| Standard | What it covers | How we use it |
|---|---|---|
| [Arazzo 1.0.1](https://www.openapis.org/arazzo-specification) (OpenAPI Initiative) | Describes multi-step API workflows: steps, dependencies, success criteria, outputs. Aimed explicitly at agents. | Publish an Arazzo document **derived from** each journey definition, so agents that understand Arazzo can follow the journey. Arazzo describes; it does not enforce, and it has no intent concept. Our engine adds both. Candidate source format for the customer module. |
| [AP2](https://ap2-protocol.org/specification/) (Agent Payments Protocol, now at FIDO Alliance with Mastercard's Verifiable Intent) | Signed "intent mandates" capturing a user's request and constraints; human-present versus human-not-present modes. | Borrow vocabulary: `human_present` instead of `user_present`. Signed intent is a later extension (section 11). |
| A2A (Agent2Agent) task lifecycle | Task states such as submitted, working, input-required, completed, canceled, failed. | Map our states to these names in the API so they read familiar. |
| MCP elicitation | An MCP server can ask the user for missing fields mid-call. | In the MCP adapter, a `fields-missing` rejection can become an elicitation request. |
| W3C Trace Context (`traceparent`) | Correlation ids across services. | Accept and log `traceparent`. Relevant for cross-site journeys (section 9). |
| IETF drafts: [Intent Declaration Primitive](https://datatracker.ietf.org/doc/draft-sato-soos-idp/05/), [Intent Token](https://www.ietf.org/archive/id/draft-williams-intent-token-00.html), [AGTP](https://datatracker.ietf.org/doc/html/draft-hood-independent-agtp-06) | Individual drafts on agents declaring intent, signed intent envelopes, and agent-native methods such as QUERY or BOOK. | Individual drafts, not adopted by a working group. Watch; do not depend on them. Not yet read in depth. |

---

## 4. Design

### 4.1 A dedicated Worker

The journey protocol gets its own Worker (`journey/`), its own D1 database
and its own demo page. It does not add routes to `gateway/`.

- It keeps the carve-out a move rather than a rewrite.
- It reuses lab code through **adapters**: identity via the gateway's
  `checkIdentity()`, user binding via the Delegate demo's code functions,
  but with the journey Worker's **own** KV namespace. The Worker issues its
  own codes (`POST /api/journey/{id}/verification-code`), scoped to one
  journey, so a code from one journey cannot complete another.
- For a customer, the adapters are swapped for their own identity and login.

### 4.2 The journey definition is data

One JSON file per journey is the single hand-authored fact, and the thing a
customer edits. Derived from it:

- the HTTP contract and self-describing refusals,
- validation rules for each step,
- the Arazzo and OpenAPI documents,
- log and funnel structure,
- the MCP tool list and input schemas.

This follows Demo 2's principle: stated policy and enforcement derive from
one object, so they cannot drift.

Field schemas use a **small subset of JSON Schema** (type, enum, format,
pattern, minimum, maximum, length, required), so the validator stays
dependency-free and the schemas can be emitted unchanged to Arazzo and MCP.

### 4.3 Pure engine, thin adapters

```
journey definition (JSON)
        │
        ▼
engine: start() · prepareStep() + applyStep() · cancel()   ← pure, unit-tested, no I/O
        │  accept(newState, result) | reject(reason, details)
        ▼
transports:  HTTP (phase 3) · MCP (phase 7) · customer proxy (phase 8)
adapters:    identity · user binding · sinks
        │
        ▼
D1 store + sinks (D1 always, webhook optional) → analytics API → dashboard
```

Node 24 runs TypeScript tests directly, so `node --test` is enough.

### 4.4 Rejected calls, failed journeys, cancelled and abandoned journeys

These stay distinct in the data.

| What happened | Journey status | Journey continues? |
|---|---|---|
| Protocol error: wrong order, missing or invalid fields, wrong agent | unchanged, event logged as rejected | Yes, the agent can correct and retry |
| Terminal step reached | `achieved` | No |
| Business rule ended it, e.g. budget below minimum | `not_achieved` with reason | No |
| Agent called cancel | `cancelled` with reason | No |
| Time-to-live passed without an end state | `abandoned`, computed lazily at read time | No |

A2A mapping in responses: `active` ↔ working, `achieved` ↔ completed,
`not_achieved` ↔ failed, `cancelled` ↔ canceled.

### 4.5 Rules that avoid rigidity

- **Dependency graph, not strict sequence.** Each step lists what it
  `requires`.
- **Idempotent completed steps**, because agents retry.
- **Deny by default** when no intent is declared.
- **Self-describing refusals.** Every rejection is problem+json naming the
  next steps, the missing or invalid fields, and the cancel link.
- **Progressive disclosure.** The start asks only for the core intent. Each
  step asks for what it needs at that point. Asking for everything up front
  drives agents away.

### 4.6 Identity binding

A definition sets `identity` to `required` or `optional`.

- `required`: every call must pass identity verification and be signed by
  the **same key** that started the journey.
- `optional`: unsigned agents may run the journey, bound by the journey id
  alone. Signed agents are still bound to their key. This is the realistic
  default today, since few agents sign, and the likely mode for MCP.

The dashboard always separates verified from unverified journeys, so the
unverified share is visible rather than hidden.

A step can additionally require **user binding** via a one-time code, and can
require `human_present: true`.

### 4.7 Logging, sinks and privacy

- Tables `journeys` and `journey_events` in the journey Worker's own D1.
- Sinks configured, not coded: D1 on by default, optional webhook forwarder.
- **Data minimization:** step field values are stored only where the
  definition marks them `log: true`. Fields marked `sensitive`, such as the
  email and the one-time code, are never stored in any form. Events record
  field names, never values.
- **The journey id is a credential** for unsigned journeys, so the dashboard
  never shows it. Journeys are addressed there by a one-way `ref` (the first
  16 hex characters of its SHA-256).

### 4.8 Honesty note for the demo page

The intent declaration is a self-report. Nothing stops an agent from lying
about its goal or inventing a plausible request summary. The protocol adds
structure, accountability tied to identity when present, and funnel
analytics. It does not enforce truthfulness.

---

## 5. The intent envelope

### 5.1 Constraints versus decision criteria

They are different, and both matter for reconstructing a prompt.

- **Constraints are hard filters.** An option that violates one is out.
  "Price under 100 USD", "must ship to Switzerland", "before 30 November".
- **Decision criteria are soft and ranked.** They decide between options
  that all pass the constraints. "Cheapest first", "prefer Swiss provider",
  "fast delivery matters more than brand".

"Price under 100 USD" is therefore a constraint. "As cheap as possible" is a
decision criterion. Keeping them apart tells the site owner *why* an agent
drops out: a violated constraint means the offer never qualified, a weak
criterion means it qualified but lost.

Both are structured, with a free-text escape hatch, so they can be
aggregated in the dashboard.

### 5.2 Envelope v1

Required fields are marked. Everything else is optional, and the dashboard
shows an **intent completeness score** per journey and per agent.

```json
{
  "intent": "qualify",
  "goal": "Find a consultant to make our B2B shop usable by AI shopping agents",
  "request_summary": "User asked: find someone in Switzerland who can make our shop work with ChatGPT agents, under 5k, before end of November",
  "human_present": true,
  "agent_session": "chatgpt-work-5f1c",

  "principal": {
    "type": "business",
    "role": "head of e-commerce",
    "industry": "industrial supplies",
    "organization_size": "50-249",
    "locale": "de-CH",
    "region": "CH"
  },

  "journey_stage": "shortlisting",

  "constraints": [
    { "field": "price", "op": "lte", "value": 5000, "unit": "EUR" },
    { "field": "deadline", "op": "lte", "value": "2026-11-30" },
    { "field": "language", "op": "in", "value": ["de", "en"] },
    { "note": "must not require a platform migration" }
  ],

  "decision_criteria": [
    { "criterion": "price", "direction": "minimize", "weight": 0.4 },
    { "criterion": "proven agent-readiness experience", "weight": 0.4 },
    { "criterion": "local presence", "weight": 0.2 }
  ],

  "alternatives_considered": ["competitor-a.example", "in-house"],

  "authority": {
    "can_commit": false,
    "spend_limit": null,
    "needs_approval_from": "user"
  },

  "expected_deliverable": "shortlist with recommendation",
  "discovery_source": "web-search",
  "agent_claim": { "product": "ChatGPT Work", "platform": "openai" },
  "parent_journey": null
}
```

| Field | Required | Why it helps reconstruct the prompt |
|---|---|---|
| `intent` | yes | Coarse category, enum: discover, compare, qualify, verify, transact, support |
| `goal` | yes | The job to be done, in the agent's words |
| `human_present` | yes | Whether a person is waiting, or the agent runs in the background |
| `request_summary` | no | Closest thing to the original prompt: a paraphrase, never verbatim and never personal data. Agents may refuse or invent; still the richest single field. |
| `agent_session` | no | Correlates several journeys from the same agent task |
| `principal` | no | Who the agent acts for. Coarse on purpose: no names, no contact data. |
| `journey_stage` | no | Enum: researching, shortlisting, deciding, buying, post-purchase |
| `constraints` | no | Hard filters, structured |
| `decision_criteria` | no | Soft, ranked criteria |
| `alternatives_considered` | no | The comparison set, which is competitive intelligence |
| `authority` | no | Whether the agent may commit or spend, in the spirit of AP2 mandates |
| `expected_deliverable` | no | What the agent will hand back to its user |
| `discovery_source` | no | How the agent found this site: web-search, model-knowledge, link, marketplace, direct |
| `agent_claim` | no | Self-reported agent product, compared on the dashboard with the verified identity |
| `parent_journey` | no | For cross-site journeys (section 9) |

### 5.3 Reconstructing the prompt

The dashboard shows a **reconstructed prompt** per journey, built from the
envelope plus logged step fields with a **fixed template**
(`journey/src/engine/prompt.ts`). It is deterministic, free, can only restate
what the agent declared, and is labelled as a reconstruction. It is stored
with the journey and refreshed on every accepted step.

An LLM-written version, more natural but needing an API key and costing a
little per journey, is an open decision (section 11).

---

## 6. Protocol v0 (HTTP)

### Endpoints

| Method and path | Purpose |
|---|---|
| `GET /.well-known/agent-journeys` | Discovery: lists journey definitions with links |
| `GET /journeys/{definition_id}` | The definition: steps, dependencies, field schemas, end states |
| `GET /.well-known/api-catalog` | RFC 9727 API catalog pointing at each journey's OpenAPI document |
| `GET /journeys/{definition_id}/openapi.json` | Derived OpenAPI 3.1, one operation per step |
| `GET /journeys/{definition_id}/arazzo.json` | Derived Arazzo 1.0.1 workflow over that OpenAPI document |
| `POST /api/journey/start` | Intent handshake; returns `journey_id`, `next_steps`, `expires_at`, cancel link |
| `POST /api/journey/{journey_id}/steps/{step}` | Perform a step with its fields |
| `POST /api/journey/{journey_id}/cancel` | End the journey with a reason |
| `POST /api/journey/{journey_id}/verification-code` | One-time code for a user-binding step; only once that step is next. Demo: returned in the response |
| `GET /api/journey/{journey_id}` | Current state |
| `GET /api/analytics/*` | Dashboard data (section 7) |

Every response carries RFC 8288 `Link` headers to the discovery document and
the API catalog. A signature that fails verification is refused with
`401 identity-invalid`, never silently treated as unsigned.

### Cancel

Agents may just leave, and abandoned journeys cover that. But an explicit
cancel costs almost nothing and carries the single most valuable signal: why
the journey ended. The cancel link is included in every response to make it
discoverable.

```json
POST /api/journey/jrn_01J9Z8.../cancel
{
  "reason": "constraint-unmet",
  "detail": "Earliest start date is after the user's deadline",
  "alternative_chosen": "competitor-a.example"
}
```

Reason codes: `user-declined`, `constraint-unmet`, `price-too-high`,
`found-alternative`, `missing-information`, `user-unavailable`,
`agent-error`, `other`. `detail` and `alternative_chosen` are optional.

### Status codes

| Code | Reason code | Meaning |
|---|---|---|
| `201` | | Journey started |
| `200` | | Step accepted or journey cancelled |
| `401` | `identity-required` | Journey requires identity and the request is unsigned |
| `401` | `identity-invalid` | A signature was sent but did not verify, or was replayed |
| `403` | `user-binding-failed` | Wrong, expired or reused one-time code |
| `403` | `wrong-agent` | Journey started by a different key |
| `403` | `human-presence-required` | Step needs `human_present: true` |
| `404` | `journey-unknown` | No such journey |
| `409` | `step-out-of-order` | Required steps not done yet; names them |
| `409` | `journey-closed` | Journey already ended |
| `409` | `concurrent-update` | Another call changed the journey first; read and retry |
| `410` | `journey-expired` | Journey passed its time-to-live |
| `422` | `intent-missing` / `fields-missing` / `fields-invalid` | Names each offending field and its expected schema |

### Example refusal

```json
{
  "status": 409,
  "type": "https://lab.eleviq.solutions/journey/#step-out-of-order",
  "title": "Step 'verify' requires steps that are not completed yet",
  "reason": "step-out-of-order",
  "missing_steps": ["qualify"],
  "next_steps": [{ "step": "qualify", "href": "...", "fields": { "...": "..." } }],
  "cancel": "/api/journey/jrn_01J9Z8.../cancel"
}
```

### Example journey: lead qualification

Fits ElevIQ's own business. Four steps:

| Step | Requires | Asks for | Notes |
|---|---|---|---|
| `discover` | | nothing | Returns the service catalogue |
| `qualify` | discover | customer type, problem, budget, deadline, all `log: true` | Ends as `not_achieved` with `below-minimum-budget` if budget is under 2000 EUR |
| `verify` | qualify | email and one-time code | Requires `human_present: true`; code from Demo 3's request-code endpoint |
| `transact` | verify | requested action: book-call or request-quote | Terminal, `achieved` |

The full JSON lives in `journey/definitions/lead-qualification.json` once
phase 1 is built.

---

## 7. Analytics dashboard

A dedicated dashboard, part of the journey module rather than the existing
Measure or insights dashboards, so it ships with the module to customers.

- Served by the journey Worker as static assets at `/dashboard/`, reading
  `/api/analytics/*`.
- **Lab:** public, since no personal data is stored and journey ids are
  never shown. **Customer:** behind Cloudflare Access, as `insights` is today.

Views:

| View | Shows |
|---|---|
| Funnel | Journeys started, reaching each step, and ending in each status, per definition and time range |
| Drop-off | Per step: rejection reasons, cancel reasons, abandonment |
| Intent explorer | Distribution of intents, stages, principal types, constraints and decision criteria; budget and deadline buckets |
| Competitive view | `alternatives_considered` and `alternative_chosen` counts |
| Agents | Verified versus unverified, agent claims versus verified identity, completeness score per agent |
| Journey list | Filterable table of journeys |
| Journey detail | Timeline of every event, the envelope, logged fields, reconstructed prompt |

Charts follow the dataviz guidance already used for the lab's dashboards.

---

## 8. Data model (journey Worker's own D1)

As built, from `journey/schema.sql`:

```sql
-- One row per journey. Only fields a definition marks `log: true` are stored
-- (step_data); fields marked `sensitive` (emails, codes) never are.
CREATE TABLE IF NOT EXISTS journeys (
  id                   TEXT PRIMARY KEY,      -- "jrn_" + 128 random bits, base32. A credential: never shown on the dashboard
  ref                  TEXT NOT NULL UNIQUE,  -- public reference for the dashboard: sha-256(id), first 16 hex chars
  definition_id        TEXT NOT NULL,
  definition_version   INTEGER NOT NULL,
  status               TEXT NOT NULL,         -- active | achieved | not_achieved | cancelled | abandoned
  end_reason           TEXT,
  end_detail           TEXT,
  alternative_chosen   TEXT,
  keyid                TEXT,                  -- binding key; null when started unsigned
  agent_name           TEXT,                  -- verified agent name
  trust_tier           TEXT,
  intent               TEXT NOT NULL,         -- the intent envelope, JSON
  intent_kind          TEXT NOT NULL,         -- envelope.intent, for grouping
  human_present        INTEGER NOT NULL,
  completeness         REAL NOT NULL,         -- 0..1 share of optional envelope fields supplied
  completed_steps      TEXT NOT NULL,         -- JSON array
  step_data            TEXT NOT NULL,         -- JSON: per step, log:true fields only
  reconstructed_prompt TEXT,                  -- template reconstruction, refreshed on every accepted step
  transport            TEXT NOT NULL,         -- http | mcp
  traceparent          TEXT,                  -- W3C Trace Context, if the agent sent one
  revision             INTEGER NOT NULL,      -- optimistic concurrency
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  expires_at           TEXT NOT NULL,         -- idle timeout; lazily turned into "abandoned"
  ended_at             TEXT
);

CREATE INDEX IF NOT EXISTS journeys_created ON journeys (created_at DESC);
CREATE INDEX IF NOT EXISTS journeys_def_status ON journeys (definition_id, status);

-- One row per call attempt, accepted or rejected. Field NAMES only, never values.
CREATE TABLE IF NOT EXISTS journey_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id     TEXT,                        -- null for a refused start
  definition_id  TEXT,
  ts             TEXT NOT NULL,
  step           TEXT NOT NULL,               -- "start", a step name, "cancel", or "verification-code"
  outcome        TEXT NOT NULL,               -- accepted | rejected
  reason         TEXT,                        -- rejection reason code
  status         INTEGER NOT NULL,            -- HTTP status returned
  details        TEXT,                        -- JSON: offending field names, missing steps
  keyid          TEXT,
  transport      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS journey_events_journey ON journey_events (journey_id, ts);
CREATE INDEX IF NOT EXISTS journey_events_def ON journey_events (definition_id, ts);
```

---

## 9. Cross-site journeys, explained

A cross-site journey is one user task that an agent completes across
**several independent websites**, where each site sees only its own part.

**Example.** A user tells their agent: "Find a quiet, energy-efficient heat
pump for our house, under 12,000 CHF installed, and book an installer."

1. The agent compares models on a **manufacturer** site and picks one.
2. It checks stock and price at a **retailer** site.
3. It books an appointment on an **installer** site.

Today each site sees an isolated fragment. The manufacturer never learns that
its model was chosen and installed, nor that a competitor's model lost on
noise level. The retailer does not know the request came from a
manufacturer's recommendation.

**With cross-site journeys**, the first site hands the agent a **journey
token**: a signed, short-lived token carrying the journey id, the issuing
site and the envelope. The agent passes it to the next site as
`parent_journey`. Each participating site links its own journey to the
parent and can report the outcome back, through a webhook to the issuer or to
a shared collector.

The result is attribution for agentic commerce: the manufacturer learns
which recommendations turned into installations, much like affiliate or
UTM tracking, but carried by the agent rather than a browser cookie.

**Why it is out of scope for now.**
- The agent must choose to carry the token; nothing forces it.
- Sites must trust each other's tokens, which needs a key directory, like
  Demo 1's, per site.
- Passing intent between companies is a privacy question the user must
  consent to.

The simplest real case for a customer is **one company, several domains**:
for example a shop plus a separate booking or support domain. Trust and
consent are easy there, and it tests the mechanism.

---

## 10. Implementation plan

Eight phases. Phases 1 to 5 deliver the working prototype with dashboard.
Phase 6 proves it with a real agent. Phases 7 and 8 lead to the customer
module.

Phases 1 to 5 are **done** (2026-09-29); see section 13 for verification
results and deviations.

### Phase 1: Engine and definition format

**Goal:** a pure, tested state machine driven by a JSON definition.

| Task | Files | Done when |
|---|---|---|
| 1.1 Types for definitions, envelope v1, state, results | `journey/src/engine/types.ts` | Typecheck passes |
| 1.2 JSON Schema subset validator | `journey/src/engine/validate.ts` | Returns `{field, problem, expected}` items, never throws |
| 1.3 Definition loader and linter: unknown `requires`, cycles, no terminal step, `end_if` on unknown fields | `journey/src/engine/definitions.ts`, `journey/definitions/lead-qualification.json` | A broken definition fails at load with a clear message |
| 1.4 `start()`, `prepareStep()` + `applyStep()`, `cancel()`: dependencies, validation, `end_if`, terminal steps, idempotency, expiry, key binding, completeness score | `journey/src/engine/engine.ts` | Every reason code in section 6 reachable |
| 1.5 Unit tests for every reason code and every end status | `journey/test/*.test.ts`, root `package.json` script `test:journey` | Green |

### Phase 2: Worker scaffold and persistence

**Goal:** a deployable journey Worker with storage and sinks.

| Task | Files | Done when |
|---|---|---|
| 2.1 Worker scaffold, D1 `eleviq-lab-journeys`, own `NONCES` and `DELEGATION_CODES` KV, npm scripts `dev:journey` and `deploy:journey` | `journey/wrangler.toml`, `journey/src/index.ts`, `package.json` | `wrangler dev` serves `GET /` |
| 2.2 Schema from section 8 | `journey/schema.sql` | Applied locally |
| 2.3 Store with an optimistic `revision` check and lazy expiry | `journey/src/store.ts` | Two concurrent step calls cannot both win |
| 2.4 Sinks: D1 and webhook, from config, via `ctx.waitUntil` | `journey/src/sinks.ts`, `journey/src/config.ts` | A failing webhook never fails a response |
| 2.5 Adapters: identity wrapping `checkIdentity()`, user binding wrapping `checkDelegation()` | `journey/src/adapters/*.ts` | The engine never imports gateway code directly |

### Phase 3: HTTP transport

**Goal:** the protocol reachable end to end.

| Task | Done when |
|---|---|
| 3.1 Discovery, API catalog, definition, start, step, cancel, verification-code and status routes with problem+json refusals | Every row of the status table reproducible with curl |
| 3.2 Arazzo and OpenAPI documents derived from the definition | Arazzo document passes a validator, for example Spectral's Arazzo ruleset |
| 3.3 Second trusted demo key `demo-agent-b` in the gateway directory and key scripts | Wrong-agent scenario returns `403 wrong-agent`; Demo 1 unaffected |
| 3.4 Reference client `docs/reference/journey-run.mjs`, signed, runs the full journey | Green against local Worker |

### Phase 4: Demo page

**Goal:** `/journey/` explains and drives the protocol, in the style of the
other demos.

| Task | Done when |
|---|---|
| 4.1 Page: problem, console, how it works, standards alignment, try it yourself, honesty note | Reads like the other demo pages |
| 4.2 Console scenarios: happy path, skipped step, missing fields, below budget, wrong agent, cancel, expired, unsigned agent under `identity: optional` | Each shows request, response and journey state |
| 4.3 Journey timeline panel for the current journey | Accepted and rejected attempts visible |
| 4.4 Landing card on `docs/index.html` linking page and dashboard | Linked |

The expired scenario uses a short-TTL variant of the demo definition.

### Phase 5: Analytics dashboard

**Goal:** the dedicated dashboard from section 7.

| Task | Done when |
|---|---|
| 5.1 Analytics API: funnel, drop-off, intent distributions, competitive view, agents, journey list and detail | Capped rows, no raw emails |
| 5.2 Dashboard static assets served by the journey Worker | All views of section 7 render with seeded data |
| 5.3 Seed script generating varied realistic journeys, for development only | Dashboard meaningful before real traffic |
| 5.4 Reconstructed prompt. Built as a fixed template; an LLM version is still open | Labelled as reconstructed |

### Phase 6: Deploy and real-agent test

| Task | Done when |
|---|---|
| 6.1 Remote D1 schema, deploy Worker, commit page assets | Live |
| 6.2 Reference script and all console scenarios against production | Green |
| 6.3 Test with an AI assistant (ChatGPT agent mode), prompt kept on the page; the assistant discovers the journey via `lab.eleviq.solutions/llms.txt` | Journey visible on the dashboard with verified identity; findings written up |
| 6.4 Terse PLAN.md entry and README status table update | Done |

Suggested prompt:

```text
Find out whether ElevIQ could help my company become agent-ready. Start at
lab.eleviq.solutions. We are a B2B shop, budget around 5000 EUR, deadline end
of November. Use my email for verification.
```

### Phase 7: MCP transport

**Goal:** the same journeys as MCP tools, generated from the definition.

Options:

| Option | Pros | Cons |
|---|---|---|
| **A. Cloudflare `createMcpHandler`** (Agents SDK, stateless, on the official MCP TypeScript SDK) | Protocol details and version negotiation handled by maintained code; no Durable Objects; one handler inside the existing Worker | Adds the SDK dependency and its update cadence |
| B. Hand-rolled JSON-RPC for `initialize`, `tools/list`, `tools/call` | No dependencies; roughly 150 lines | We track MCP spec changes ourselves; easy to get subtly wrong |
| C. Cloudflare `McpAgent` with Durable Objects | Per-session state, built-in OAuth provider for user binding | More infrastructure; session state is unnecessary because journey state already lives in D1 |

**Recommendation: option A.** Journey state is in D1, so the MCP layer can be
stateless. Move to option C only when OAuth-based user binding is wanted.

| Task | Done when |
|---|---|
| 7.1 `/mcp` endpoint via `createMcpHandler` | Connects from Claude and ChatGPT connector settings |
| 7.2 Tools generated from the definition: `start_journey`, one `journey_<step>` per step, `cancel_journey` | Editing the JSON changes the tools without code changes |
| 7.3 `fields-missing` becomes an MCP elicitation where the client supports it, else a tool error with the same reason code | Both paths tested |
| 7.4 Dashboard splits journeys by transport | Visible |

MCP clients do not send Web Bot Auth signatures, so MCP journeys run under
`identity: optional`.

### Phase 8: Customer module

| Task | Done when |
|---|---|
| 8.1 Move `journey/` to a standalone package with README, config and example Worker | The lab imports it unchanged |
| 8.2 Upstream mapping: a step can declare `upstream: "POST /api/quote"`; accepted calls are proxied to the customer origin with the journey id as a header | A step's result comes from a real origin |
| 8.3 Identity, user binding and sink adapters for common customer setups, for example API keys and their own login | Two implementations each |
| 8.4 Consider Arazzo with `x-journey-*` extensions as the source format | Decision recorded |
| 8.5 Customer setup guide | A new journey deploys in under an hour |

---

## 11. Decisions

| Decision | Outcome |
|---|---|
| Identity mandatory? | No. Per definition: `required` or `optional`. Dashboard separates verified from unverified. |
| Where the demo sits | Dedicated demo and dedicated Worker, to keep it separate for the carve-out. |
| Second trusted demo key | Yes. |
| Store step field values | Only fields marked `log: true`; `sensitive` fields such as emails and codes never. |
| Journey id format | `jrn_` plus 128 random bits, base32. |
| Protocol name | Keep "Agent Journey Protocol" as an ElevIQ profile; align with Arazzo, AP2, A2A, MCP and Trace Context. |
| MCP implementation | `createMcpHandler`, stateless. Revisit for OAuth. |
| Analytics UI | Dedicated dashboard in the journey Worker. |
| Cancel call | Yes, with reason codes. |
| Constraints versus decision criteria | Separate structured fields. |

Still open: whether to add an **LLM-written** reconstructed prompt on top
of the template version that was built. It needs an API key and costs a
little per journey.

---

## 12. Out of scope for the prototype

- Payment inside a journey via x402, reusing Demo 4.
- Cross-site journeys (section 9).
- Signed intent envelopes in the spirit of AP2 mandates and the IETF Intent
  Token draft.
- A visual definition editor.
- OAuth-based user binding.

---

## 13. Build status (2026-09-29)

Phases 1 to 5 are built and verified against `wrangler dev`. Nothing is
deployed. Code lives in `journey/` (Worker, engine, definitions, dashboard),
`docs/journey/` and `docs/assets/journey.js` (demo page),
`docs/reference/journey-run.mjs` (reference client) and
`scripts/seed-journeys.ts` (local seed data).

**Verified:**

| Check | Result |
|---|---|
| Engine unit tests (`npm run test:journey`) | 24 pass |
| Typecheck, gateway and journey | clean |
| Reference client, all 8 scenarios, local Worker | 8/8 behave as designed |
| Edge cases: wrong or reused code, code for another email, tampered and replayed signatures, malformed input, discovery documents, no journey ids in analytics | 22/22 |
| Arazzo and OpenAPI documents, Spectral `arazzo` and `oas` rulesets | 0 errors, 0 warnings |
| Demo page, all 8 scenarios, headless Chromium | all correct, no console errors, no overflow at 390px |
| Dashboard, light and dark and 390px, with 180 seeded journeys | renders, no console errors, no overflow |
| Outcome palette, dataviz validator | passes light and dark; light-mode contrast warning covered by the chart's table view |

**Deviations from the plan:**

- **Verification codes are issued by the journey Worker itself**
  (`POST /api/journey/{id}/verification-code`), reusing the Delegate demo's
  code module with the Worker's own KV, instead of sharing the gateway's KV.
  Codes are scoped to one journey. Keeps the module self-contained.
- **The gateway's `access_log` is not extended** with journey columns: with a
  dedicated Worker, journey events live in the journey database.
- **The reconstructed prompt is template-based**, not LLM-written. It is
  deterministic, free, and can only restate what the agent declared. The
  LLM version remains the open decision in section 11.
- **Added:** `revision` for optimistic concurrency, a one-way `ref` so the
  dashboard never exposes journey ids (they are credentials for unsigned
  journeys), an RFC 9727 `/.well-known/api-catalog`, Link headers on every
  response, and a signature that fails verification is refused rather than
  treated as unsigned.
- **The example journey uses `identity: optional`**, the realistic default.
  `required` is implemented and unit-tested.
- **Small gateway changes:** `checkIdentity()`, `claimNonce()` and the
  delegation functions now accept any environment with the storage they
  use; a second trusted demo key `demo-agent-b` is in the directory.

**Before the first deploy (phase 6):**

1. Create the resources and paste their ids into `journey/wrangler.toml`,
   which holds placeholders:
   ```bash
   npx wrangler d1 create eleviq-lab-journeys
   npx wrangler kv namespace create JOURNEY_NONCES
   npx wrangler kv namespace create JOURNEY_CODES
   npx wrangler d1 execute eleviq-lab-journeys --config journey/wrangler.toml --remote --file=journey/schema.sql
   ```
2. `npm run deploy:gateway` so the gateway's directory publishes `demo-agent-b`.
3. `npm run deploy:journey`. The page and landing card assume the URL
   `eleviq-lab-journey.gateway-worker.workers.dev`; adjust `docs/journey/index.html`
   and `docs/index.html` if wrangler reports another.
4. `npm run build`, then commit and push `docs/` so Pages serves the page,
   the new key and the reference client. The landing card says "Live", so
   push only after step 3.
5. Run `node docs/reference/journey-run.mjs --base <worker URL> --scenario all`
   against production, then the real-agent test.
