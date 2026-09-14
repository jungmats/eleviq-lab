/**
 * Minimal RSL (Really Simple Licensing, rslstandard.org) build + parse.
 *
 * Genuine, spec-shaped XML — not a JSON stand-in — but deliberately narrow: only
 * the <permits type="usage">/<prohibits type="usage"> vocabulary this demo needs
 * (search | ai-input | ai-train), not RSL's full surface (payment terms, other
 * <permits>/<prohibits> types, multiple <content> blocks, etc).
 */
import { XMLParser } from "fast-xml-parser";

export type UsageType = "search" | "ai-input" | "ai-train";

export interface UsagePolicy {
  permits: UsageType[];
  prohibits: UsageType[];
}

export function buildRslXml(policy: UsagePolicy, contentUrl: string): string {
  const permits = policy.permits.length
    ? `      <permits type="usage">${policy.permits.join(" ")}</permits>\n`
    : "";
  const prohibits = policy.prohibits.length
    ? `      <prohibits type="usage">${policy.prohibits.join(" ")}</prohibits>\n`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rsl xmlns="https://rslstandard.org/rsl">\n` +
    `  <content url="${contentUrl}">\n` +
    `    <license>\n${permits}${prohibits}    </license>\n` +
    `  </content>\n` +
    `</rsl>\n`
  );
}

const KNOWN: UsageType[] = ["search", "ai-input", "ai-train"];

export function parseRslXml(xml: string): UsagePolicy {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  const license = doc?.rsl?.content?.license ?? {};
  // A node with both an attribute (type="usage") and text content parses as
  // { "@_type": "usage", "#text": "..." } rather than a plain string — read
  // through #text, falling back to the raw value for a plain-string node.
  const textOf = (v: unknown): string =>
    v && typeof v === "object" && "#text" in (v as Record<string, unknown>)
      ? String((v as Record<string, unknown>)["#text"])
      : String(v ?? "");
  const tokens = (v: unknown): UsageType[] =>
    textOf(v)
      .split(/\s+/)
      .filter((t): t is UsageType => (KNOWN as string[]).includes(t));
  return { permits: tokens(license.permits), prohibits: tokens(license.prohibits) };
}
