// Entry point for the browser bundle used by the Demo 4 (Charge) console.
// esbuild bundles this to docs/assets/charge-sign.js (see build/bundle.mjs).
// Real EIP-712 signing and real Base Sepolia RPC reads, in the browser —
// same "prove it, don't narrate it" bar as agent-sign.js for Web Bot Auth.
export { createPublicClient, http, parseAbi } from "viem";
export { baseSepolia } from "viem/chains";
export { privateKeyToAccount } from "viem/accounts";
