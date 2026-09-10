// Entry point for the browser bundle used by the Demo 1 console.
// esbuild bundles this to public/assets/agent-sign.js (see build/bundle.mjs).
export { sign, generateNonce } from "web-bot-auth";
export { signerFromJWK } from "web-bot-auth/crypto";
