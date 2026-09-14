/**
 * GET /.well-known/rsl.xml — the STATED policy for Demo 2: a real,
 * spec-shaped RSL license (rslstandard.org), scoped to one specific
 * resource. No canonical path is mandated by the RSL spec itself; this is
 * our own choice, consistent with this gateway's existing .well-known
 * convention for the Web Bot Auth key directory.
 */
import { text } from "../lib/http";
import { rslXmlFor } from "../lib/policy";

export function handleLicense(request: Request): Response {
  return text(rslXmlFor(new URL(request.url).origin), 200, "application/xml; charset=utf-8");
}
