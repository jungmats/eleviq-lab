import assert from "node:assert/strict";
import { test } from "node:test";
import { isPageView } from "../src/features/logging/page-view.ts";

const BASE = "https://eleviq.solutions";

function view(path: string, status: number, contentType: string | null, method = "GET"): boolean {
  const headers = contentType ? { "content-type": contentType } : undefined;
  const body = status === 304 ? null : "body";
  return isPageView(new Request(BASE + path, { method }), new Response(body, { status, headers }));
}

test("a 200 HTML or Markdown response is a page view", () => {
  assert.equal(view("/", 200, "text/html; charset=utf-8"), true);
  assert.equal(view("/booking/", 200, "text/markdown; charset=utf-8"), true);
});

test("a 200 response that is not a page is not a view", () => {
  assert.equal(view("/styles.css", 200, "text/css"), false);
  assert.equal(view("/llms.txt", 200, "text/plain"), false);
  assert.equal(view("/.well-known/mcp/server-card.json", 200, "application/json"), false);
});

test("an error response is not a view", () => {
  assert.equal(view("/missing", 404, "text/html"), false);
  assert.equal(view("/", 500, "text/html"), false);
});

test("a redirect is not a view", () => {
  assert.equal(view("/old", 301, "text/html"), false);
});

test("a 304 for a page is a view, with no Content-Type", () => {
  for (const path of ["/", "/booking/", "/technologies", "/technologies.html", "/fr/index.html", "/x.HTM"]) {
    assert.equal(view(path, 304, null), true, path);
  }
});

test("a 304 for an asset or discovery file is not a view", () => {
  for (const path of [
    "/lang.js",
    "/styles.css",
    "/icon.png",
    "/fonts/manrope-variable.woff2",
    "/llms.txt",
    "/robots.txt",
    "/sitemap.xml",
    "/.well-known/api-catalog",
    "/.well-known/mcp/server-card.json",
  ]) {
    assert.equal(view(path, 304, null), false, path);
  }
});

test("a HEAD request is not a view", () => {
  assert.equal(view("/", 200, "text/html", "HEAD"), false);
  assert.equal(view("/", 304, null, "HEAD"), false);
});
