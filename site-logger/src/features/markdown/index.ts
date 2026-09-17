import { wantsMarkdown } from "./negotiate";
import { htmlToMarkdown } from "./html-to-markdown";

/**
 * Applies markdown content negotiation to an HTML response: if the request
 * asked for text/markdown (see negotiate.ts) and the response is a
 * servable HTML page, returns a converted text/markdown representation at
 * the same URL and status. Otherwise returns the original response with a
 * `Vary: Accept` header appended, so caches downstream know this URL's
 * representation depends on the Accept header even when they only ever
 * see the HTML branch.
 *
 * Always returns a response (never null) — safe to unconditionally
 * reassign the pipeline's `response` variable to this function's result.
 */
export async function applyMarkdownNegotiation(request: Request, response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const isNegotiableHtml = contentType.includes("text/html") && response.ok;
  if (!isNegotiableHtml) return response;

  if (wantsMarkdown(request)) {
    const html = await response.clone().text();
    const markdown = await htmlToMarkdown(html);
    return new Response(markdown, {
      status: response.status,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        vary: "Accept",
      },
    });
  }

  const withVary = new Response(response.body, response);
  withVary.headers.append("Vary", "Accept");
  return withVary;
}
