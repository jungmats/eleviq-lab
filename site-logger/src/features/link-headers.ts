import type { DiscoveryLink } from "../config";

/**
 * Adds RFC 8288 `Link` discovery headers to a response — e.g. pointing
 * agents at a sitemap or llms.txt without requiring them to fetch and
 * parse the HTML first. Pure and config-driven: pass a different `links`
 * list to reuse this for a different site.
 */
export function addDiscoveryLinkHeaders(response: Response, links: DiscoveryLink[]): Response {
  if (links.length === 0) return response;
  // Clone so we can add headers — the upstream Response from fetch() is
  // otherwise treated as immutable in the Workers runtime.
  const withHeaders = new Response(response.body, response);
  for (const { rel, path } of links) {
    withHeaders.headers.append("Link", `<${path}>; rel="${rel}"`);
  }
  return withHeaders;
}
