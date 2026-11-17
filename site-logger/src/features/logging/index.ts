import { classifyReferral, createSignatureChecker, isBrowserUserAgent, matchUserAgent } from "../../../../shared/index.ts";
import { classifyVisitor } from "./classify.ts";
import { writePageView, type PageViewEntry } from "./log.ts";
import { isPageView } from "./page-view.ts";
import type { Env } from "../../lib/env.ts";

/** Header ElevIQ's own test tools send (requirements INT-1, INT-2). */
export const INTERNAL_HEADER = "X-ElevIQ-Internal";

/** Bot User-Agents are kept up to this length; longer ones are cut (storage bound). */
const UA_RAW_MAX = 512;

// One checker per isolate, so its key-directory cache lives across requests (LOG-4).
// Rebuilt only if the deployment setting differs, which in production it never does.
let checker: ReturnType<typeof createSignatureChecker> | null = null;
let checkerAcceptsDemo: boolean | null = null;

function signatureChecker(env: Env) {
  const acceptDemo = env.ACCEPT_DEMO_SIGNATURES === "true";
  if (!checker || checkerAcceptsDemo !== acceptDemo) {
    checker = createSignatureChecker({ acceptDemo });
    checkerAcceptsDemo = acceptDemo;
  }
  return checker;
}

/**
 * Constant-time token comparison: both sides are hashed first, so the byte
 * comparison is over equal lengths and leaks neither length nor prefix.
 */
async function isInternal(sent: string | null, secret: string | undefined): Promise<0 | 1> {
  if (!sent || !secret) return 0;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(sent)),
    crypto.subtle.digest("SHA-256", enc.encode(secret)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0 ? 1 : 0;
}

/** LOG-2: only non-browser or attested User-Agents are stored; "" for an empty one. */
function rawUserAgent(ua: string | null, cfCategory: string | null): string | null {
  if (!ua) return "";
  if (isBrowserUserAgent(ua) && !cfCategory) return null;
  return ua.slice(0, UA_RAW_MAX);
}

/** Error text only — never the request or its headers, which may carry the internal token. */
function describe(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : typeof err;
}

/**
 * Visitor logging for a page response — see page-view.ts for what counts as a
 * page view. Returns at once: signature checking, the token comparison and the
 * D1 write all run in ctx.waitUntil, so the response is never delayed or
 * affected (LOG-5).
 */
export function logVisit(request: Request, response: Response, env: Env, ctx: ExecutionContext): void {
  try {
    if (!isPageView(request, response)) return;
    ctx.waitUntil(
      (async () => {
        try {
          const cf = request.cf as { country?: string; verifiedBotCategory?: string } | undefined;
          const cfCategory = cf?.verifiedBotCategory || null;
          const ua = request.headers.get("User-Agent");
          const legacy = classifyVisitor(ua);
          const referral = classifyReferral(request.headers.get("Referer"), request.url);
          const [sig, internal] = await Promise.all([
            signatureChecker(env).check(request),
            isInternal(request.headers.get(INTERNAL_HEADER), env.ELEVIQ_INTERNAL_TOKEN),
          ]);
          const entry: PageViewEntry = {
            path: new URL(request.url).pathname,
            visitor: legacy.name,
            visitorCategory: legacy.category,
            cfBotCategory: cfCategory,
            referrerAgent: referral?.by ?? null,
            referralSignal: referral?.signal ?? null,
            country: cf?.country ?? null,
            uaMatch: matchUserAgent(ua)?.name ?? null,
            uaRaw: rawUserAgent(ua, cfCategory),
            sigStatus: sig.sig_status,
            sigAgent: sig.sig_agent,
            internal,
          };
          await writePageView(env, entry);
        } catch (err) {
          console.error("site-logger: page view not logged:", describe(err));
        }
      })(),
    );
  } catch (err) {
    console.error("site-logger: logging step failed:", describe(err));
  }
}
