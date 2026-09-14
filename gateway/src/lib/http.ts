/** Small response helpers shared by the demo endpoints. */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "Content-Type, Accept, Signature, Signature-Input, Signature-Agent, X-Demo-Agent-Claim, X-Agent-Purpose",
  "access-control-max-age": "600",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

/** application/problem+json (RFC 9457). */
export function problem(
  status: number,
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ status, ...body }, null, 2), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8", ...CORS, ...extra },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Plain text (robots.txt, RSL XML) — still needs CORS so a page on another
 * origin can fetch and display it. */
export function text(
  body: string,
  status = 200,
  contentType = "text/plain; charset=utf-8",
  extra: Record<string, string> = {},
) {
  return new Response(body, { status, headers: { "content-type": contentType, ...CORS, ...extra } });
}
