# ElevIQ Lab — Web Bot Auth reference

End-to-end, from nothing, using the real client-side signing code.

- **Gateway** (the API): `https://eleviq-lab-gateway.workers.dev`
- **This site** (script + demo keys): `https://lab.eleviq.solutions`

## 1. Look, no signature

```bash
curl -i https://eleviq-lab-gateway.workers.dev/api/identity/price-list
```

`401`. The JSON body is the machine-readable hint an agent uses to discover it
must authenticate — it names the scheme, the key directory, and (for this demo)
where to get a key and a signer.

## 2. Sign it — with just curl

`POST /api/sign` holds a demo key and signs for you. **This is a test aid, not
how Web Bot Auth works** — a real agent signs with its own key (step 3).

```bash
curl -s -X POST https://eleviq-lab-gateway.workers.dev/api/sign \
  -H 'content-type: application/json' \
  -d '{"url":"https://eleviq-lab-gateway.workers.dev/api/identity/price-list"}'
```

Replay the three headers it returns against the resource → `200` + the full list.
The response also includes a ready-made `replay` command.

## 3. Sign it — the real client-side way

```bash
mkdir wba && cd wba
npm init -y && npm install web-bot-auth

curl -O https://lab.eleviq.solutions/reference/sign-request.mjs
curl -O https://lab.eleviq.solutions/reference/demo-agent.jwk.json

node sign-request.mjs \
  --url https://eleviq-lab-gateway.workers.dev/api/identity/price-list \
  --key demo-agent.jwk.json --send
```

`sign-request.mjs` is ~40 lines: load the Ed25519 JWK, `sign()` the request
(covering `@target-uri` and `Signature-Agent`), send it.

- Drop `--send` to print a `curl` command instead of sending.
- `curl -O https://lab.eleviq.solutions/reference/untrusted-agent.jwk.json` then
  `--key untrusted-agent.jwk.json` → `401`, key not in the directory.

## 4. What the gateway does

`gateway/src/lib/verify.ts` in the repo:

1. no `Signature` / `Signature-Input` → `unsigned`
2. read `Signature-Agent`, fetch its
   `/.well-known/http-message-signatures-directory`
3. look up the signing key by thumbprint (`keyid`); not found → `unknown-key`
4. verify the Ed25519 signature over the covered components
5. check `created` / `expires` (with clock skew)
6. map the verified `keyid` to an operator identity

In production the gateway then proxies the verified request through to the
customer's origin. Or the customer enables Web Bot Auth at the Cloudflare edge
and reads a verified-agent signal — same library, no gateway of their own.
