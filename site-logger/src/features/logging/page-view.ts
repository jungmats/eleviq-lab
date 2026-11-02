/**
 * Whether a request/response pair counts as a page view.
 *
 * A 304 is a real visit: the client asked for the page and only the body was
 * skipped, because its cached copy is current. A 304 carries no Content-Type,
 * so it is recognised by path instead. HEAD requests fetch no page, so they
 * are never a view.
 */
export function isPageView(request: Request, response: Response): boolean {
  if (request.method !== "GET") return false;

  if (response.status === 304) return isPagePath(new URL(request.url).pathname);

  const contentType = response.headers.get("content-type") ?? "";
  return response.ok && (contentType.includes("text/html") || contentType.includes("text/markdown"));
}

/** True for /, /booking/, /technologies and /x.html, false for assets and discovery files. */
function isPagePath(pathname: string): boolean {
  if (pathname.startsWith("/.well-known/")) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !lastSegment.includes(".") || /\.html?$/i.test(lastSegment);
}
