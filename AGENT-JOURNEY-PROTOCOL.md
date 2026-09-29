# Agent Journey Protocol — concept, design and implementation plan

**Status (2026-09-29): proposal, nothing built yet.**
First target: a new demo in ElevIQ Lab (`/journey/`), served by the existing
gateway Worker. Second target: the same code extracted into a module ElevIQ
can deploy and customize for customers.

"Agent Journey Protocol" is a working name for an ElevIQ convention. It is
not a ratified standard, and the demo page should say so, the same way Demo 2
says `X-Agent-Purpose` is a lab convention.

---

## 1. The idea

A customer journey becomes an explicit, monitored entity for agents.

- A **journey** is a sequence of tool calls (steps) through which an agent
  changes state towards a clear end state: *achieved* or *not achieved*.
- An agent **starts** a journey and receives a `journey_id`. Every later call
  must carry it.
- A step is **accepted only** when the earlier steps it depends on are done
  **and** the agent supplies the information that step demands.
- The agent opens with an **intent declaration handshake**: intent, goal,
  constraints, user presence, agent session.
- The `journey_id` lets every log line be **correlated** into one journey, so
  you can see which journeys complete, which fail, at which step and why.
- Journeys are **bound to agent identity** (Web Bot Auth, Demo 1) and can
  additionally be bound to a **user** (delegation, Demo 3).
- Steps act as structured intake: they ask for business-relevant fields
  such as customer type, problem, budget and deadline. The site owner learns
  *why* agents come, not only *that* they come.

Intent envelope, as sketched:

```json
{
  "intent": "discover | compare | qualify | verify | transact | support",
  "goal": "...",
  "constraints": {},
  "requested_action": "...",
  "user_present": true,
  "agent_session": "..."
}
```

---

## 2. What the lab already has

Most of the building blocks exist. The protocol generalizes them behind one
declarative journey definition.

| Idea element | Already in the lab | Gap |
|---|---|---|
| Intent declaration | Demo 2's `X-Agent-Purpose` header, deny-by-default (`gateway/src/lib/policy.ts`) | One field only, no structured envelope |
| Multi-step stateful flow | Demo 3: request-code, then account; KV state, single-use, TTL, distinct failure reasons | Hard-coded two steps, no journey id |
| Logging | D1 `access_log`, one row per request (`gateway/src/lib/log.ts`) | Rows cannot be correlated into journeys |
| Agent identity | `checkIdentity()` in `gateway/src/lib/verify.ts`, own keys + ChatGPT Work registry | Not bound to a session |
| Configurable features | `site-logger/src/config.ts` feature toggles | Not used by the gateway |
| Dashboards | `/measure/` over `/api/log` | No funnel view |

---

## 3. Design decisions

### 3.1 The journey definition is data

One JSON file per journey. It is the single hand-authored fact, and the
thing a customer edits. Everything else derives from it:

- the HTTP contract and the self-describing error messages,
- the validation rules for each step,
- the log and funnel structure,
- later, the MCP tool list and each tool's input schema.

This follows Demo 2's principle: the RSL license and the enforcement both
derive from one policy object, so stated and enforced rules cannot drift.

Field schemas use a **small subset of JSON Schema** (type, enum, format,
minimum, maximum, minLength, maxLength, required). A subset keeps the
validator hand-written and dependency-free, and it can be emitted unchanged
as an MCP `inputSchema` later.

### 3.2 Pure engine, thin adapters

```
journey definition (JSON)
        │
        ▼
engine.advance(definition, state, step, payload, now)  ← pure, unit-tested
        │  returns accept(newState, result) | reject(reason, details)
        ▼
adapters:  HTTP routes (phase 3)  ·  MCP tools (phase 6)  ·  customer proxy (phase 7)
        │
        ▼
store (D1) + event sinks (D1 always, webhook optional)
```

The engine has no I/O, so it can be tested with plain `node --test`. Node 24
runs TypeScript directly, so no test framework or build step is needed.

### 3.3 Rejected calls versus failed journeys

These are different things and must stay distinct in the data.

- A **rejected call** is a protocol error: wrong order, missing fields,
  invalid values, wrong agent. The journey stays active and the agent can
  correct itself and retry. The rejection is logged as an event.
- A **failed journey** is a business outcome: the journey reached an end
  state of *not achieved*, for example because the budget is below the
  minimum. It is closed and cannot continue.
- An **abandoned journey** passed its time-to-live without reaching an end
  state. It is computed lazily at read time, so no cron job is needed.

End states: `achieved`, `not_achieved` (with a reason), `abandoned`.

### 3.4 Rules that avoid rigidity

- **Dependency graph, not strict sequence.** Each step lists the steps it
  `requires`. Steps without mutual dependencies can happen in any order.
- **Completed steps are idempotent.** Repeating a completed step with the
  same payload returns the same result, because agents retry.
- **Deny by default.** A missing intent declaration refuses the start, as in
  Demo 2.
- **Self-describing refusals.** Every rejection is `application/problem+json`
  naming the expected next steps and the missing or invalid fields, so an
  agent can recover without reading the demo page.

### 3.5 Identity binding

A definition sets `identity` to one of:

- `required`: every call must pass `checkIdentity()`, and every step must be
  signed by the **same key** that started the journey. Without this, a
  journey id is a bearer token anyone who sees it can hijack.
- `optional`: unsigned agents may run the journey, bound by the journey id
  alone. Signed agents are still bound to their key. This mode exists
  because most real agents do not sign yet, and it is also the likely mode
  for MCP clients.

A step can additionally require **user binding** via Demo 3's one-time code,
and can require `user_present: true` in the intent.

### 3.6 Logging and sinks

- Two new D1 tables: `journeys` (one row per journey) and `journey_events`
  (one row per step attempt, accepted or rejected).
- The existing `access_log` gets `journey_id` and `journey_step` columns, so
  Demo 5's view and the journey funnel join cleanly.
- Sinks are configured, not coded, following the site-logger pattern: D1 on
  by default, plus an optional webhook forwarder that posts each event as
  JSON. A customer can push events into their own analytics without touching
  the engine.
- **Data minimization.** Step field values are stored only where the
  definition marks them `log: true`. Emails are never stored raw. The Demo 3
  code and similar secrets are never stored.

### 3.7 Honesty note for the demo page

The intent declaration is a self-report, just like `X-Agent-Purpose`.
Nothing stops an agent from lying about its goal. What the protocol adds is
structure, accountability tied to a verified identity, and funnel analytics.
It does not enforce truthfulness. The page should say this in one sentence.

---

## 4. Protocol v0 (HTTP)

### Endpoints

| Method and path | Purpose |
|---|---|
| `GET /.well-known/agent-journeys` | Discovery: lists available journey definitions with links |
| `GET /api/journey/definitions/{definition_id}` | The full definition: steps, dependencies, field schemas, end states |
| `POST /api/journey/start` | Intent handshake; returns `journey_id`, `next_steps`, `expires_at` |
| `POST /api/journey/{journey_id}/steps/{step}` | Perform a step with its fields |
| `GET /api/journey/{journey_id}` | Current state: completed steps, next steps, status |
| `GET /api/journey/log` | Funnel summary and recent journeys for the dashboard, capped like `/api/log` |

### Status codes

| Code | Reason code | Meaning |
|---|---|---|
| `201` | | Journey started |
| `200` | | Step accepted; body carries new state, `next_steps` and the step's result |
| `401` | `identity-required` | Definition requires identity and the signature is missing or invalid |
| `403` | `wrong-agent` | Journey was started by a different key |
| `403` | `user-presence-required` | Step needs `user_present: true` |
| `404` | `journey-unknown` | No such journey |
| `409` | `step-out-of-order` | Required steps not done yet; names them |
| `409` | `journey-closed` | Journey already ended |
| `410` | `journey-expired` | Journey passed its time-to-live |
| `422` | `intent-missing` / `fields-missing` / `fields-invalid` | Names every offending field and its expected schema |

### Example exchange

```http
POST /api/journey/start
Signature-Input: ...
Signature: ...
Content-Type: application/json

{
  "definition": "lead-qualification",
  "intent": {
    "intent": "qualify",
    "goal": "Find an agent-readiness consultant for our B2B shop",
    "constraints": { "language": "de", "region": "CH" },
    "requested_action": "book-call",
    "user_present": true,
    "agent_session": "chatgpt-work-5f1c"
  }
}
```

```json
{
  "journey_id": "jrn_01J9Z8...",
  "status": "active",
  "completed_steps": [],
  "next_steps": [
    { "step": "discover", "href": "/api/journey/jrn_01J9Z8.../steps/discover", "fields": { "...": "..." } }
  ],
  "expires_at": "2026-09-29T14:30:00Z"
}
```

A skipped step:

```json
{
  "status": 409,
  "type": "https://lab.eleviq.solutions/journey/#step-out-of-order",
  "title": "Step 'verify' requires steps that are not completed yet",
  "reason": "step-out-of-order",
  "missing_steps": ["qualify"],
  "next_steps": [{ "step": "qualify", "href": "...", "fields": { "...": "..." } }]
}
```

---

## 5. Example journey: lead qualification

Chosen because it fits ElevIQ's own business and composes Demos 1, 2 and 3
into one storyline.

```json
{
  "id": "lead-qualification",
  "version": 1,
  "title": "Qualify for an agent-readiness engagement",
  "identity": "required",
  "ttl_seconds": 1800,
  "intent": {
    "required": ["intent", "goal", "user_present", "agent_session"],
    "properties": {
      "intent": { "type": "string", "enum": ["discover", "compare", "qualify", "verify", "transact", "support"] },
      "goal": { "type": "string", "minLength": 10, "maxLength": 500 },
      "constraints": { "type": "object" },
      "requested_action": { "type": "string" },
      "user_present": { "type": "boolean" },
      "agent_session": { "type": "string", "maxLength": 128 }
    }
  },
  "steps": {
    "discover": {
      "requires": [],
      "description": "Returns the service catalogue.",
      "fields": { "required": [], "properties": {} }
    },
    "qualify": {
      "requires": ["discover"],
      "fields": {
        "required": ["customer_type", "problem", "budget_eur", "deadline"],
        "properties": {
          "customer_type": { "type": "string", "enum": ["b2b-shop", "saas", "publisher", "services", "other"], "log": true },
          "problem": { "type": "string", "minLength": 20, "maxLength": 1000, "log": true },
          "budget_eur": { "type": "number", "minimum": 0, "log": true },
          "deadline": { "type": "string", "format": "date", "log": true }
        }
      },
      "end_if": [
        { "field": "budget_eur", "lt": 2000, "status": "not_achieved", "reason": "below-minimum-budget" }
      ]
    },
    "verify": {
      "requires": ["qualify"],
      "require_user_present": true,
      "user_binding": "delegation-code",
      "fields": {
        "required": ["acting_for", "delegation_code"],
        "properties": {
          "acting_for": { "type": "string", "format": "email" },
          "delegation_code": { "type": "string", "pattern": "^[0-9]{6}$" }
        }
      }
    },
    "transact": {
      "requires": ["verify"],
      "terminal": "achieved",
      "fields": {
        "required": ["requested_action"],
        "properties": {
          "requested_action": { "type": "string", "enum": ["book-call", "request-quote"], "log": true }
        }
      }
    }
  }
}
```

The `verify` step reuses Demo 3's existing `POST /api/delegate/request-code`
to obtain the code, and `checkDelegation()` to check it.

---

## 6. Data model (D1)

```sql
CREATE TABLE IF NOT EXISTS journeys (
  id                 TEXT PRIMARY KEY,      -- "jrn_" + random
  definition_id      TEXT NOT NULL,
  definition_version INTEGER NOT NULL,
  status             TEXT NOT NULL,         -- active | achieved | not_achieved | abandoned
  end_reason         TEXT,                  -- e.g. below-minimum-budget, ttl-expired
  keyid              TEXT,                  -- binding key; null only in identity:optional + unsigned
  agent_name         TEXT,
  trust_tier         TEXT,
  intent             TEXT NOT NULL,         -- the intent declaration, JSON
  user_present       INTEGER NOT NULL,
  agent_session      TEXT,
  completed_steps    TEXT NOT NULL,         -- JSON array
  step_data          TEXT NOT NULL,         -- JSON; only fields marked log:true
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  ended_at           TEXT
);

CREATE TABLE IF NOT EXISTS journey_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  journey_id  TEXT,                         -- null for a refused start
  ts          TEXT NOT NULL,
  step        TEXT NOT NULL,                -- "start" or a step name
  outcome     TEXT NOT NULL,                -- accepted | rejected
  reason      TEXT,                         -- reason code on rejection
  status      INTEGER NOT NULL,
  details     TEXT,                         -- JSON: missing/invalid field names, never values
  keyid       TEXT
);

CREATE INDEX IF NOT EXISTS journey_events_journey ON journey_events (journey_id, ts);
CREATE INDEX IF NOT EXISTS journeys_created ON journeys (created_at DESC);

-- access_log migration
ALTER TABLE access_log ADD COLUMN journey_id TEXT;
ALTER TABLE access_log ADD COLUMN journey_step TEXT;
```

Journey state lives in D1 rather than KV because the funnel needs queries
across journeys. KV stays in use for nonces and delegation codes.

---

## 7. Implementation plan

Seven phases. Phases 1 to 4 deliver the first working prototype in the lab.
Phase 5 proves it with a real agent. Phases 6 and 7 are the path to a
reusable customer module.

All journey code lives in its own folder, `gateway/src/journey/`, with no
imports from demo-specific modules except through small adapter interfaces.
That keeps phase 7's extraction a move, not a rewrite.

### Phase 1 — Engine and definition format

**Goal:** a pure, tested state machine driven by a JSON definition.

| Task | Files | Done when |
|---|---|---|
| 1.1 Types for definitions, state, payloads and results | `gateway/src/journey/types.ts` | Typecheck passes |
| 1.2 JSON Schema subset validator: type, enum, format (email, date), pattern, min/max, length, required | `gateway/src/journey/validate.ts` | Returns a list of `{field, problem, expected}`, never throws |
| 1.3 Definition loader and linter: unknown `requires`, cycles, missing terminal step, `end_if` on unknown fields | `gateway/src/journey/definitions.ts`, `gateway/journeys/lead-qualification.json` | A broken definition fails at load with a clear message |
| 1.4 `start()` and `advance()`: dependency check, field validation, `end_if`, terminal steps, idempotent repeats, expiry, identity binding check | `gateway/src/journey/engine.ts` | All reason codes of section 4 reachable |
| 1.5 Unit tests covering every reason code, happy path, idempotency, expiry, `not_achieved` path | `gateway/test/journey/*.test.ts`, `package.json` script `test` | `npm test` green |

**Verify:** `npm test` and `npm run typecheck`.

### Phase 2 — Persistence and sinks

**Goal:** journeys and events stored, access log correlated.

| Task | Files | Done when |
|---|---|---|
| 2.1 Add tables and `access_log` migration | `gateway/schema.sql` (migration comments in the existing style) | Applied locally with `wrangler d1 execute --local` |
| 2.2 Store: load, save with optimistic `updated_at` check, lazy expiry to `abandoned` | `gateway/src/journey/store.ts` | Concurrent step calls cannot both win |
| 2.3 Sink interface with D1 sink and webhook sink, driven by config; writes via `ctx.waitUntil` so logging never fails a response | `gateway/src/journey/sinks.ts`, `gateway/src/journey/config.ts` | Webhook off by default; a failing webhook is logged and ignored |
| 2.4 Extend `AccessLogEntry` with `journeyId` and `journeyStep` | `gateway/src/lib/log.ts` | Existing demos unaffected |

**Verify:** local D1 inspection after a scripted run.

### Phase 3 — HTTP routes

**Goal:** the protocol reachable end to end over HTTP.

| Task | Files | Done when |
|---|---|---|
| 3.1 Discovery and definition endpoints | `gateway/src/journey/routes.ts` | Definition served exactly as loaded |
| 3.2 Start, step and status endpoints; identity via `checkIdentity()`; problem+json refusals with `next_steps` | same | Every row of the status table reproducible with curl |
| 3.3 Delegation adapter for `user_binding: delegation-code` calling `checkDelegation()` | `gateway/src/journey/adapters/delegation.ts` | Verify step works with a code from `/api/delegate/request-code` |
| 3.4 Funnel endpoint: counts per status, drop-off per step, top rejection reasons, recent journeys; capped rows, no raw emails | `gateway/src/journey/routes.ts` | Returns sensible numbers after the smoke script |
| 3.5 Wire routes, CORS headers, bump `VERSION`, extend `info()` and README endpoint table | `gateway/src/index.ts`, `gateway/src/lib/http.ts`, `README.md` | `GET /` lists the new endpoints |
| 3.6 Reference client script that runs the whole journey signed, in the style of `sign-request.mjs` | `docs/reference/journey-run.mjs` | Runs green against `wrangler dev` |

**Verify:** the reference script against local gateway; `npm run typecheck`.

### Phase 4 — Demo page and funnel view

**Goal:** `/journey/` with the same layout and conventions as the other demos.

| Task | Files | Done when |
|---|---|---|
| 4.1 Page: §1 the problem, §2 console, §3 how it works, §4 try it yourself, honesty note | `docs/journey/index.html` | Reads like the other demo pages |
| 4.2 Console with scenarios: happy path, skipped step, missing fields, below-budget (`not_achieved`), wrong agent, expired | `docs/assets/journey.js` | Each scenario shows request, response and resulting journey state |
| 4.3 Journey timeline panel: steps as a row, accepted and rejected attempts marked | `docs/assets/journey.js`, `docs/lab.css` | Visible for the current journey |
| 4.4 Funnel panel from `/api/journey/log` | same | Drop-off per step and top reasons visible |
| 4.5 Landing card on `docs/index.html` | `docs/index.html` | Linked, same card style |

The **wrong agent** scenario needs a second trusted demo key, since the
existing untrusted key fails identity with `401` before binding is checked.
Add `demo-agent-b` via `scripts/gen-keys.mjs` and the directory. See the
decisions in section 8.

The **expired** scenario uses a definition with a short time-to-live, or a
debug override limited to the demo definition.

**Verify:** headless Chromium click-through of every scenario against local
gateway, then human review of the page.

### Phase 5 — Deploy and real-agent test

**Goal:** proof with a genuine third-party agent, not only the console.

| Task | Done when |
|---|---|
| 5.1 Remote D1 migration, `npm run deploy:gateway`, commit page and assets for Pages | Live page works against the production gateway |
| 5.2 Re-run the reference script and all console scenarios against production | All green |
| 5.3 Real-agent test with ChatGPT Work, prompt kept on the page as in Demo 3 | Journey visible in the funnel with the agent's verified identity; outcome and any agent refusals written up |
| 5.4 Short PLAN.md entry and memory update | Terse, per the PLAN.md convention |

Suggested prompt:

```text
Find out whether ElevIQ could help my company become agent-ready. Start at
https://eleviq-lab-gateway.gateway-worker.workers.dev/.well-known/agent-journeys
and follow the journey it describes. We are a B2B shop, budget around 5000 EUR, deadline end
of November. Use my email for verification.
```

### Phase 6 — MCP adapter

**Goal:** the same journey exposed as MCP tools, generated from the definition.

| Task | Done when |
|---|---|
| 6.1 Stateless Streamable HTTP endpoint at `/mcp` handling `initialize`, `tools/list`, `tools/call` | Connects from Claude and ChatGPT connector settings |
| 6.2 Tool generation: `start_journey` with the intent schema, one `journey_<step>` tool per step with `journey_id` plus the step's fields as `inputSchema` | Editing the JSON definition changes the tools with no code change |
| 6.3 Tool calls go through the same `advance()`; rejections returned as tool errors carrying the same reason codes | Funnel shows MCP and HTTP journeys side by side, marked by transport |

MCP clients do not send Web Bot Auth signatures, so MCP journeys run under
`identity: optional` or a later OAuth binding. Hand-rolling the three
JSON-RPC methods avoids the Durable Object dependency of Cloudflare's
`McpAgent`. Decide that at the start of the phase.

### Phase 7 — Reusable customer module

**Goal:** a kit ElevIQ drops in front of a customer's existing API.

| Task | Done when |
|---|---|
| 7.1 Move `gateway/src/journey/` to a standalone folder with its own README, config and example Worker | Lab gateway imports it unchanged |
| 7.2 Upstream mapping: a step can declare `upstream: "POST /api/quote"`, and the Worker proxies the accepted call to the customer origin, passing `journey_id` as a header | A step's result comes from a real origin |
| 7.3 Adapter interfaces for identity, user binding and sinks, so a customer can swap Web Bot Auth for API keys or their own login | Two adapters implemented for each |
| 7.4 Customer setup guide: write a definition, pick sinks, deploy, read the funnel | A new definition deploys in under an hour |
| 7.5 Later: a form-based definition editor, in the spirit of the policy editor idea in PLAN.md | Out of scope for the prototype |

---

## 8. Decisions to make before or during the build

| Decision | Recommendation |
|---|---|
| Where the demo sits in the pipeline | Its own demo after Measure, since it composes Identify, Decide and Delegate. It does not fit Sustain's monetization scope. |
| Add a second trusted demo key for the wrong-agent scenario | Yes. Small change to the directory; makes the hijack protection visible. |
| Store step field values | Only fields marked `log: true`, never emails or codes. |
| Journey id format | `jrn_` plus 128 random bits, base32. Unguessable even in `identity: optional` mode. |
| Protocol name on the page | "Agent Journey Protocol (ElevIQ lab convention)". Avoid implying a standard. |
| MCP implementation | Hand-rolled stateless JSON-RPC, unless streaming or sessions turn out to be needed. |

---

## 9. Out of scope for the prototype

- Charging inside a journey via x402. A natural later step: a `payment`
  binding on a step, reusing Demo 4.
- Cross-site journeys, where one journey spans several customer domains.
- Signed intent declarations, where the agent signs the envelope itself
  rather than only the HTTP request.
- A visual definition editor.
- OAuth-based user binding.
