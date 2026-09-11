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
 * Later: policy (Decide), HTTP 402 (Charge), analytics (Measure).
 *
 * The demo site that explains and drives this lives separately, on GitHub Pages
 * at https://lab.eleviq.solutions
 */
import { handleDirectory } from "./routes/directory";
import { handlePriceList } from "./routes/price-list";
import { handleSign } from "./routes/sign";
import { handleDebugCf } from "./routes/debug";
import { json, preflight } from "./lib/http";
import type { Env } from "./lib/env";

const VERSION = "2026-09-10-demo1";
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

  return json(
    {
      error: "not_found",
      hint: "GET / describes this gateway.",
      endpoints: [
        "/.well-known/http-message-signatures-directory",
        "/api/identity/price-list",
        "/api/sign",
        "/api/debug/cf",
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
