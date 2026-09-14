/**
 * GET /.well-known/rsl.xml — the richer half of the STATED policy: a real,
 * spec-shaped RSL license (rslstandard.org). No canonical path is mandated
 * by the RSL spec itself; this is our own choice, linked to from /robots.txt
 * via a License: line, per RSL's own convention.
 */
import { text } from "../lib/http";
import { rslXmlFor } from "../lib/policy";

export function handleLicense(request: Request): Response {
  return text(rslXmlFor(new URL(request.url).origin), 200, "application/xml; charset=utf-8");
}
