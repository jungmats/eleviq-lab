# shared — visitor classification core

One module that every Agent Analytics component classifies through: the logger (`site-logger`), the
visitor dashboard (`insights`) and the journey worker
(`jungmats.github.io/_journey-worker`, via a synced copy).

Spec: `agent-analytics/requirements-visitor-evidence.md` in the consulting-methodology repo.

| File | What |
|---|---|
| `signatures.ts` | User-Agent signature list (kind, `cfVerifies`), browser and automation test, Cloudflare category mapping, referral by Referer and `utm_source`, operator allow-list for signatures |
| `derive.ts` | `deriveVisitor(signals)` → kind, level, method, name, flags, notes, referral; old rows included; `signalKey` for grouping |
| `signature-check.ts` | `createSignatureChecker(...)` → Web Bot Auth status `none` / `valid` / `invalid` / `unverifiable` |
| `legend.en.json`, `legend.fr.json` | Every customer-facing text about evidence (requirements §5.8) |
| `index.ts` | Public API |

## Rules

- **Edit only here.** Other repos get a copy:
  `node scripts/sync-shared.mjs <target-dir>`. The copy carries a GENERATED header and a
  `SHARED_MANIFEST.json`. `node scripts/sync-shared.mjs --check <target-dir>` fails when the copy is
  out of date or edited by hand.
- **Pure code.** No Worker bindings or globals. Fetch, clock and cache are passed in, so tests run
  without network access.
- **Node-runnable TypeScript.** No enums, no parameter properties; relative imports use `.ts`; JSON
  is imported `with { type: "json" }`.
- **Never add private key material.** The demo key's public half is in `OPERATORS`, and it is only
  accepted where `acceptDemo` is on.

## Tests

```
npm run test:shared     # decision table, old rows, journeys, checker, legends, sync
npm run typecheck
```
