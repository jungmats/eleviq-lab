/**
 * GET /.well-known/http-message-signatures-directory
 *
 * The Web Bot Auth key directory. A verifier that receives a signed request
 * reads the `Signature-Agent` header, fetches this document from that origin,
 * and looks up the signing key by its thumbprint (`keyid`).
 *
 * Here the "agent" and the "verifier" are both this gateway, so Signature-Agent
 * points back at us and we serve our own trusted keys.
 */
import { directoryKeys } from "../lib/keys";

export function handleDirectory(): Response {
  return new Response(JSON.stringify({ keys: directoryKeys() }, null, 2), {
    headers: {
      "content-type": "application/http-message-signatures-directory+json",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}
