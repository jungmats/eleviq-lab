/**
 * GET /robots.txt — the STATED side of Demo 2's stated-vs-enforced contrast.
 * A real Content-Signal line (+ a License: pointer to the RSL file) for this
 * gateway's own origin. Genuinely fetchable; genuinely what the enforcement
 * decision reads (see lib/policy.ts) — publishing it here enforces nothing
 * by itself, which is the point.
 */
import { text } from "../lib/http";
import { robotsTxtFor } from "../lib/policy";

export function handleRobotsTxt(request: Request): Response {
  return text(robotsTxtFor(new URL(request.url).origin));
}
