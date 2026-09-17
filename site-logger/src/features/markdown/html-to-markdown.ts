/**
 * Converts a page's HTML into a plain-text Markdown representation, using
 * Cloudflare's native HTMLRewriter — no bundled DOM/library, so this stays
 * small and Workers-idiomatic. Two passes:
 *
 *   1. HTMLRewriter streams through the markup: non-content elements
 *      (head, footer, nav, script, style, form, the hidden request-scope
 *      modal, decorative images, the language-switch link) are dropped
 *      entirely, and plain-text markdown tokens ("# ", "- ", "[", "](url)",
 *      "**") are spliced in around the elements that carry structure or
 *      meaning (headings, lists, links, bold text). Note `<header>` itself
 *      is deliberately *not* removed wholesale — on this site's homepage
 *      the page's own `<h1>` lives inside it, so only its known chrome
 *      (logo image, language switch) is stripped and the heading passes
 *      through like any other.
 *   2. A final pass strips any remaining raw tags (div/section/ul wrapper
 *      elements that carried no markdown-relevant structure of their own)
 *      and collapses excess whitespace left behind by the removals.
 *
 * This deliberately isn't a general-purpose HTML→Markdown library: it
 * targets the small, consistent set of tags this site's own templates use.
 * A client with richer markup (tables, nested lists, images worth
 * preserving, …) would need a fuller converter — swap this file out; the
 * rest of the markdown feature doesn't know or care how the conversion
 * happens.
 */
export async function htmlToMarkdown(html: string): Promise<string> {
  const rewriter = new HTMLRewriter()
    .on("head, footer, nav, script, style, form, .modal-overlay, img, .lang-switch", {
      element(el) {
        el.remove();
      },
    })
    .on("h1, h2, h3, h4, h5, h6", {
      element(el) {
        const level = Number(el.tagName[1]);
        el.before("#".repeat(level) + " ", { html: false });
        el.after("\n\n", { html: false });
      },
    })
    .on("li", {
      element(el) {
        el.before("- ", { html: false });
        el.after("\n", { html: false });
      },
    })
    .on("p", {
      element(el) {
        el.after("\n\n", { html: false });
      },
    })
    .on("strong, b", {
      element(el) {
        el.before("**", { html: false });
        el.after("**", { html: false });
      },
    })
    .on("a[href]", {
      element(el) {
        const href = el.getAttribute("href") ?? "";
        el.before("[", { html: false });
        el.after(`](${href})`, { html: false });
      },
    });

  const transformed = rewriter.transform(new Response(html, { headers: { "content-type": "text/html" } }));
  const streamed = await transformed.text();

  const withoutTags = streamed
    .replace(/<[^>]+>/g, "") // strip remaining raw tags (div/section/ul wrappers, …)
    .replace(/\[\]\([^)]*\)/g, ""); // drop image-only links emptied by removing <img> above
  const decoded = decodeHtmlEntities(withoutTags);
  const collapsedLines = decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n");

  return collapsedLines.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// HTML source indentation/newlines inside tags survive as literal text-node
// whitespace once tags are stripped — collapsed above — and named/numeric
// entities aren't decoded by HTMLRewriter's text handling, so common ones
// are decoded explicitly here rather than pulling in a full entity table.
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "—",
  "&ndash;": "–",
  "&hellip;": "…",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&lsquo;": "‘",
  "&rsquo;": "’",
  "&middot;": "·",
  "&copy;": "©",
  "&reg;": "®",
  "&trade;": "™",
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(
      /&(amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip|ldquo|rdquo|lsquo|rsquo|middot|copy|reg|trade);/g,
      (m) => HTML_ENTITIES[m] ?? m,
    )
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
