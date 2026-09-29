# Agent Journey Worker

A customer journey as an explicit, enforced and logged entity for agents. An
agent declares its intent, gets a journey id, and moves through steps that
are accepted only in order and only with the information each step asks for.
Every attempt is logged, so journeys read as a funnel on the dashboard.

Concept, design, standards alignment and the full plan:
[`../AGENT-JOURNEY-PROTOCOL.md`](../AGENT-JOURNEY-PROTOCOL.md).

## Layout

```
definitions/           journey definitions (JSON) — what a customer edits
src/engine/            pure protocol engine: no I/O, runs under node --test
  engine.ts            start · prepareStep/applyStep · cancel · expire · nextSteps
  envelope.ts          the intent envelope schema and completeness score
  validate.ts          JSON Schema subset validator
  definitions.ts       definition linter, dependency order
  export.ts            derived OpenAPI 3.1 and Arazzo 1.0.1 documents
  prompt.ts            template-based prompt reconstruction
src/adapters/          swap these per deployment
  identity.ts          lab: Web Bot Auth via the gateway's verifier
  user-binding.ts      lab: one-time code via the Delegate demo's module
src/routes/            HTTP: discovery, protocol, analytics
src/store.ts           D1 persistence, optimistic concurrency
src/sinks.ts           event sinks: D1, optional webhook
src/config.ts          everything a deployment is expected to change
public/dashboard/      the analytics dashboard (static, self-contained)
schema.sql             D1 tables
test/                  engine and exporter tests
```

## Adding a journey

1. Write `definitions/<id>.json`. Mark fields worth analysing `"log": true`
   and personal data `"sensitive": true`.
2. List it in `src/journeys.ts`.
3. `npm run test:journey` and `npm run typecheck`. A broken definition fails
   at load, with every problem listed.

## For a customer deployment

- Replace the two adapters with the customer's identity and login.
- Set `config.ts`: site URL, webhook sink, `userBinding.returnCodeDirectly: false`.
- Put `/dashboard/` and `/api/analytics/` behind Cloudflare Access.
- Deploy steps: section 13 of the protocol document.
