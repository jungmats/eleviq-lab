import { INTERNAL_HEADER } from "../features/logging/index.ts";
/**
 * The request as sent to the origin: without ElevIQ's internal-traffic token
 * (INT-2), which must never leave Cloudflare. Unchanged when the header is absent.
 */
export function originRequest(request: Request): Request {
  if (!request.headers.has(INTERNAL_HEADER)) return request;
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_HEADER);
  return new Request(request, { headers });
}
