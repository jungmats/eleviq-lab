/**
 * Test path for detection field tests (agent-analytics requirements,
 * Appendix B test protocol).
 *
 * `GET /t/<id>` is answered by this Worker itself — no origin fetch — with a
 * small noindex page carrying a test phrase derived from the id. An assistant
 * asked to "open the URL and tell me the test phrase" can only answer
 * correctly if it really fetched the page. The visit is logged like any page
 * view, so every signal of the visitor is recorded under path `/t/<id>`.
 *
 * Anything else under /t/ passes through to the origin as before.
 */

const TEST_ID = /^\/t\/([a-z0-9-]{4,40})\/?$/;

const WORDS = [
  "amber", "basalt", "cedar", "delta", "ember", "fjord", "granite", "harbor", "indigo", "juniper",
  "kelp", "lagoon", "meadow", "nectar", "orchid", "pebble", "quartz", "raven", "saffron", "tundra",
  "umber", "violet", "willow", "xenon", "yarrow", "zephyr", "acorn", "bramble", "cobalt", "dune",
  "estuary", "fennel",
];

/** The id if `request` is a test-path request, else null. */
export function testId(request: Request): string | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const m = TEST_ID.exec(new URL(request.url).pathname);
  return m ? m[1] : null;
}

/** Deterministic per id: "<word>-<word>-<4 digits>". */
export async function testPhrase(id: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`eleviq-test-path:${id}`)));
  const n = ((h[2] << 8) | h[3]) % 10000;
  return `${WORDS[h[0] % WORDS.length]}-${WORDS[h[1] % WORDS.length]}-${String(n).padStart(4, "0")}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The test page for a test-path request, or null to let the request go to the origin. */
export async function testPage(request: Request): Promise<Response | null> {
  const id = testId(request);
  if (!id) return null;
  const phrase = await testPhrase(id);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ElevIQ test page ${esc(id)}</title>
</head>
<body>
<h1>ElevIQ test page</h1>
<p>This page exists for testing how AI assistants and agents visit websites.</p>
<p>Test ID: <strong>${esc(id)}</strong></p>
<p>The test phrase for ${esc(id)} is <strong>${esc(phrase)}</strong>.</p>
<p><a href="https://eleviq.solutions/">ElevIQ</a></p>
</body>
</html>
`;
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
