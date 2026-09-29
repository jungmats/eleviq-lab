/**
 * ElevIQ Lab — Agent Journey Worker.
 *
 * A customer journey as an explicit, enforced and logged entity for agents:
 * an agent declares its intent, gets a journey_id, and moves through steps
 * that are accepted only in order and only with the information each asks
 * for. Every attempt is logged, so journeys read as funnels. Design and plan:
 * AGENT-JOURNEY-PROTOCOL.md at the repo root.
 *
 *   GET  /                                          this description
 *   GET  /.well-known/agent-journeys                discovery (lab convention)
 *   GET  /.well-known/api-catalog                   RFC 9727 API catalog
 *   GET  /journeys/{id}[/openapi.json|/arazzo.json] definition and derived descriptions
 *   POST /api/journey/start                         intent handshake
 *   GET  /api/journey/{journey_id}                  state
 *   POST /api/journey/{journey_id}/steps/{step}     perform a step
 *   POST /api/journey/{journey_id}/cancel           end it with a reason
 *   POST /api/journey/{journey_id}/verification-code  one-time code for user binding (demo: returned)
 *   GET  /api/analytics/summary|journeys[/{ref}]    dashboard data
 *   GET  /dashboard/                                the analytics dashboard (static assets)
 *
 * The engine (src/engine/) is pure and tested with `npm run test:journey`.
 */
import { config } from "./config";
import { discoveryLinks, json, preflight, problem, withHeaders } from "./http";
import { handleApiCatalog, handleDefinition, handleWellKnown, PROTOCOL } from "./routes/discovery";
import { handleCancel, handleGet, handleStart, handleStep, handleVerificationCode } from "./routes/protocol";
import { handleDetail, handleList, handleSummary } from "./routes/analytics";
import type { Env } from "./env";

const VERSION = "2026-09-29-journey-prototype";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return preflight();
    try {
      return withHeaders(await route(request, url, env, ctx), url.origin);
    } catch (err) {
      console.error(err);
      return withHeaders(json({ error: "journey_error", detail: String((err as Error)?.message ?? err) }, 500), url.origin);
    }
  },
};

async function route(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const origin = url.origin;
  const m = request.method;
  const c = { env, ctx, origin, now: new Date() };

  if (path === "/" && m === "GET") return info(origin);
  if (path === "/dashboard" && m === "GET") return Response.redirect(`${origin}/dashboard/`, 301);
  if (path === "/.well-known/agent-journeys" && m === "GET") return handleWellKnown(origin);
  if (path === "/.well-known/api-catalog" && (m === "GET" || m === "HEAD")) return handleApiCatalog(origin);

  let r = /^\/journeys\/([a-z0-9-]+)(?:\/(openapi|arazzo)\.json)?$/.exec(path);
  if (r && m === "GET") return handleDefinition(r[1], origin, (r[2] as "openapi" | "arazzo") ?? "definition");

  if (path === "/api/journey/start" && m === "POST") return handleStart(request, c);

  r = /^\/api\/journey\/([^/]+)$/.exec(path);
  if (r && m === "GET") return handleGet(request, c, r[1]);
  r = /^\/api\/journey\/([^/]+)\/steps\/([^/]+)$/.exec(path);
  if (r && m === "POST") return handleStep(request, c, r[1], r[2]);
  r = /^\/api\/journey\/([^/]+)\/cancel$/.exec(path);
  if (r && m === "POST") return handleCancel(request, c, r[1]);
  r = /^\/api\/journey\/([^/]+)\/verification-code$/.exec(path);
  if (r && m === "POST") return handleVerificationCode(request, c, r[1]);

  if (config.analytics.enabled && m === "GET") {
    if (path === "/api/analytics/summary") return handleSummary(env, url);
    if (path === "/api/analytics/journeys") return handleList(env, url);
    r = /^\/api\/analytics\/journeys\/([^/]+)$/.exec(path);
    if (r) return handleDetail(env, r[1]);
  }

  return problem(
    { status: 404, reason: "bad-request", title: "Not found", detail: "GET / describes this service; GET /.well-known/agent-journeys lists the journeys." },
  );
}

function info(origin: string): Response {
  return json({
    service: "ElevIQ Lab — Agent Journey Worker",
    protocol: PROTOCOL,
    version: VERSION,
    note: "Agent Journey Protocol: an ElevIQ lab convention, not a ratified standard.",
    demo: config.site,
    start_here: `${origin}/.well-known/agent-journeys`,
    api_catalog: `${origin}/.well-known/api-catalog`,
    dashboard: `${origin}/dashboard/`,
    link: discoveryLinks(origin),
  });
}
