#!/usr/bin/env node
/**
 * Generates a field-test session sheet (agent-analytics Appendix B protocol).
 *
 *   node site-logger/scripts/field-tests.mjs <out.md> [base-url]
 *
 * One fresh test id per test, with the exact URL, the prompt or action, the
 * expected result and the phrase only a real visitor can read. Results are
 * filled in after each test with lookup.mjs.
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { testPhrase } from "../src/features/test-path.ts";

const [out, base = "https://eleviq.solutions"] = process.argv.slice(2);
if (!out) {
  console.error("usage: field-tests.mjs <out.md> [base-url]");
  process.exit(2);
}
const rnd = () => randomBytes(3).toString("hex");

const TESTS = [
  // [asm, product, how, prompt-or-action, expected]
  ["asm1", "chatgpt", "manual", "In ChatGPT (normal chat, web access on): \"Open {url} and tell me the test phrase on that page.\"", "ChatGPT-User UA, Cloudflare AI Assistant → ai-assistant, Attested"],
  ["asm1", "claude", "manual", "In Claude (claude.ai, web access on): \"Open {url} and tell me the test phrase on that page.\"", "Claude-User UA, Cloudflare AI Assistant → ai-assistant, Attested"],
  ["asm1", "perplexity", "manual", "In Perplexity: \"Open {url} and tell me the test phrase on that page.\"", "Perplexity-User UA → ai-assistant, Attested or Declared"],
  ["asm2", "chatgpt-agent", "manual", "In ChatGPT agent mode: \"Go to {url} and tell me the test phrase.\"", "Browser UA + Web Bot Auth (chatgpt.com) + Cloudflare AI Assistant → ai-assistant, Verified"],
  ["asm3", "atlas", "manual", "In ChatGPT Atlas, agent mode: \"Go to {url} and tell me the test phrase.\"", "Looks like a person: people, no evidence"],
  ["asm3", "comet", "manual", "In Perplexity Comet, assistant: \"Go to {url} and tell me the test phrase.\"", "Looks like a person: people, no evidence"],
  ["asm3", "claude-chrome", "manual", "In Chrome with Claude in Chrome: \"Go to {url} and tell me the test phrase.\"", "Looks like a person: people, no evidence"],
  ["asm11", "chatgpt", "manual", "In ChatGPT: \"Give me a clickable link to {url}\", then click the link in the answer.", "people, referred by ChatGPT (utm_source=chatgpt.com expected)"],
  ["asm11", "perplexity", "manual", "In Perplexity: \"Give me a clickable link to {url}\", then click the link in the answer.", "people, referred by Perplexity (Referer)"],
  ["asm11", "claude", "manual", "In Claude: \"Give me a clickable link to {url}\", then click the link in the answer.", "people, referred by Claude (Referer)"],
  ["asm5", "curl", "script", "curl {url}", "unknown"],
  ["asm5", "python-requests", "script", "python requests.get({url})", "unknown"],
  ["asm5", "node-fetch", "script", "Node fetch({url})", "unknown"],
  ["asm5", "playwright", "script", "Playwright headless Chromium goto({url})", "unknown (HeadlessChrome UA)"],
  ["asm12", "demo-key", "script", "Demo-key signed GET {url}", "Verified, ElevIQ demo agent"],
];

const rows = [];
for (const [asm, product, how, action, expected] of TESTS) {
  const id = `${asm}-${product}-${rnd()}`;
  const url = `${base}/t/${id}`;
  rows.push({ id, asm, product, how, url, action: action.replaceAll("{url}", url), expected, phrase: await testPhrase(id) });
}

const md = [
  "# Field-test session",
  "",
  `Generated ${new Date().toISOString()} for ${base}. Protocol: requirements Appendix B.`,
  "Look up a test with `node site-logger/scripts/lookup.mjs <id>` (from eleviq-lab).",
  "",
  "ASM-10 (journeys from Claude / ChatGPT connectors) is checked in the journey database, not here.",
  "ASM-8 (answer from an index, no visit) is set up separately and closed at the quarterly review.",
  "After the session: `node site-logger/scripts/mark-internal.mjs tests` keeps the test visits out of the figures (lookups still find them).",
  "",
  ...rows.flatMap((r) => [
    `## ${r.id}`,
    "",
    `- **Test:** ${r.asm.toUpperCase().replace("ASM", "ASM-")} · ${r.product} · ${r.how}`,
    `- **URL:** ${r.url}`,
    `- **Do:** ${r.action}`,
    `- **Expected:** ${r.expected}`,
    `- **Phrase on the page:** \`${r.phrase}\` (an assistant quoting it really fetched the page)`,
    "- **Product / version:** ",
    "- **Assistant's answer:** ",
    "- **Logged:** ",
    "- **Result:** ",
    "",
  ]),
].join("\n");

writeFileSync(out, md);
console.log(`${rows.length} tests → ${out}`);
console.log(JSON.stringify(rows.map(({ id, url, how }) => ({ id, url, how }))));
