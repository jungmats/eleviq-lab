/**
 * ElevIQ Lab — agent gateway.
 *
 * A standalone Cloudflare Worker that sits in front of an agent-facing endpoint
 * and decides what a visiting agent may do. This is the artifact ElevIQ would
 * deploy for a customer (as a Worker route or Custom Domain in front of their
 * origin); here it fronts a stand-in resource.
 *
 * Demo 1 — Identify:
 *   GET  /                                              this description
 *   GET  /.well-known/http-message-signatures-directory  trusted public keys
 *   GET  /api/identity/price-list                       the protected resource
 *   POST /api/sign                                      demo test-aid signer
 *   GET  /api/debug/cf                                  Cloudflare's own (heuristic, not
 *                                                        cryptographic) edge signals for your request
 *
 * Demo 4 — Measure (Part A, agent access only; Part B lives on eleviq.solutions):
 *   GET  /api/log                                       access_log summary + recent rows
 *
 * Demo 2 — Decide (policy, keyed on a declared purpose, not identity again):
 *   GET  /.well-known/rsl.xml                            STATED policy: RSL license
 *   GET  /api/decide/deal-notes                          the protected resource; ENFORCED
 *                                                        decision, live
 *
 * Demo 3 — Delegate (is this agent acting for a specific person?):
 *   POST /api/delegate/request-code                      SIMULATED — returns a code that a
 *                                                        real deployment would email instead
 *   GET  /api/delegate/account                            the protected resource; needs a
 *                                                        valid code for the claimed email
 *
 * Later: HTTP 402 (Charge).
 *
 * The demo site that explains and drives this lives separately, on GitHub Pages
 * at https://lab.eleviq.solutions
 */
import { handleDirectory } from "./routes/directory";
import { handlePriceList } from "./routes/price-list";
import { handleSign } from "./routes/sign";
import { handleDebugCf } from "./routes/debug";
import { handleLog } from "./routes/log";
import { handleDealNotes } from "./routes/deal-notes";
import { handleLicense } from "./routes/license";
import { handleRequestCode } from "./routes/delegate-request-code";
import { handleAccount } from "./routes/delegate-account";
import { json, preflight } from "./lib/http";
import type { Env } from "./lib/env";

const VERSION = "2026-09-14-demo3";
const SITE = "https://lab.eleviq.solutions";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return withHeaders(preflight());

    try {
      return withHeaders(await route(request, path, url, env, ctx));
    } catch (err) {
      return withHeaders(
        json({ error: "gateway_error", detail: String((err as Error)?.message ?? err) }, 500),
      );
    }
  },
};

async function route(request: Request, path: string, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (path === "/" && request.method === "GET") return info(url);

  if (path === "/.well-known/http-message-signatures-directory" && request.method === "GET") {
    return handleDirectory();
  }
  if (path === "/api/identity/price-list" && request.method === "GET") {
    return handlePriceList(request, env, ctx);
  }
  if (path === "/api/sign" && request.method === "POST") {
    return handleSign(request);
  }
  if (path === "/api/debug/cf" && request.method === "GET") {
    return handleDebugCf(request);
  }
  if (path === "/api/log" && request.method === "GET") {
    return handleLog(env);
  }
  if (path === "/.well-known/rsl.xml" && request.method === "GET") {
    return handleLicense(request);
  }
  if (path === "/api/decide/deal-notes" && request.method === "GET") {
    return handleDealNotes(request, env, ctx);
  }
  if (path === "/api/delegate/request-code" && request.method === "POST") {
    return handleRequestCode(request, env);
  }
  if (path === "/api/delegate/account" && request.method === "GET") {
    return handleAccount(request, env, ctx);
  }

  return json(
    {
      error: "not_found",
      hint: "GET / describes this gateway.",
      endpoints: [
        "/.well-known/http-message-signatures-directory",
        "/api/identity/price-list",
        "/api/sign",
        "/api/debug/cf",
        "/api/log",
        "/.well-known/rsl.xml",
        "/api/decide/deal-notes",
        "/api/delegate/request-code",
        "/api/delegate/account",
      ],
    },
    404,
  );
}

function info(url: URL) {
  return json({
    service: "ElevIQ Lab agent gateway",
    version: VERSION,
    demo: `${SITE}/identity/`,
    what_it_does:
      "Verifies visiting agents with Web Bot Auth (RFC 9421 HTTP Message Signatures, Ed25519) and gates a protected resource on the result.",
    endpoints: {
      directory: `${url.origin}/.well-known/http-message-signatures-directory`,
      protected_resource: `${url.origin}/api/identity/price-list — GET; 200 for a verified agent, else 401 + how-to-authenticate`,
      test_helper: `${url.origin}/api/sign — POST {"url": "…/api/identity/price-list"}; signs with a demo key so you can try the verified path with curl`,
      debug_cf: `${url.origin}/api/debug/cf — GET; Cloudflare's own heuristic edge signals for your request (not cryptographic, not used for any decision here)`,
      access_log: `${url.origin}/api/log — GET; summary + last 100 rows of every request to /api/identity/price-list`,
      rsl_license: `${url.origin}/.well-known/rsl.xml — GET; the STATED RSL license for /api/decide/deal-notes`,
      decide_resource: `${url.origin}/api/decide/deal-notes — GET; 200 for a verified agent declaring a permitted purpose (X-Agent-Purpose), else 403 + why`,
      delegate_request_code: `${url.origin}/api/delegate/request-code — POST {"acting_for": "email"}; SIMULATED, returns a code a real deployment would email instead`,
      delegate_resource: `${url.origin}/api/delegate/account — GET; 200 with a valid code for the claimed email (X-Acting-For, X-Delegation-Code), else 401/403`,
    },
    reference: `${SITE}/reference/`,
  });
}

/** noindex on every response — the gateway is publicly reachable but unlisted. */
function withHeaders(response: Response): Response {
  const r = new Response(response.body, response);
  r.headers.set("X-Robots-Tag", "noindex, nofollow");
  return r;
}
