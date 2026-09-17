/**
 * Minimal Accept-header content negotiation for markdown vs. HTML.
 *
 * Requires `text/markdown` to be an *explicit* token in the Accept header —
 * never inferred from a bare wildcard media range — so a plain browser or
 * default-config HTTP client (whose Accept header rarely names
 * text/markdown at all) keeps getting HTML. Among clients that do name it,
 * whichever of text/markdown / text/html carries the higher q-value wins
 * (default q=1 when omitted, per RFC 9110).
 *
 * Not a full RFC 9110 media-range implementation (no parameter matching,
 * no wildcard subtype handling like "text/*") — sufficient for the
 * concrete case real agents and this project's diagnostics send:
 * `Accept: text/markdown`.
 */
function parseAcceptWeights(accept: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const part of accept.split(",")) {
    const [range, ...params] = part.trim().split(";").map((s) => s.trim());
    if (!range) continue;
    const qParam = params.find((p) => p.startsWith("q="));
    const q = qParam ? parseFloat(qParam.slice(2)) : 1;
    weights.set(range, q);
  }
  return weights;
}

export function wantsMarkdown(request: Request): boolean {
  const accept = request.headers.get("Accept");
  if (!accept) return false;

  const weights = parseAcceptWeights(accept);
  const markdownWeight = weights.get("text/markdown");
  if (markdownWeight === undefined || markdownWeight <= 0) return false;

  const htmlWeight = weights.get("text/html") ?? weights.get("*/*") ?? 0;
  return markdownWeight >= htmlWeight;
}
