/**
 * Demo 4 — Charge: x402 payment terms, verification, and settlement.
 *
 * This gateway plays BOTH roles a real x402 deployment would normally split
 * across two parties: the MERCHANT (decides the price, serves the resource)
 * and the FACILITATOR (checks a payment authorization is genuine, then
 * submits it on-chain). The protocol is explicitly permissionless — "anyone
 * can run a facilitator" — so self-hosting a minimal one here is a real
 * option, not a simplification of the real thing. It avoids a dependency on
 * a third-party account (e.g. Coinbase Developer Platform) this demo doesn't
 * need: verifying an EIP-712 signature and submitting a transaction are both
 * things a Cloudflare Worker can do directly against a public RPC endpoint.
 *
 * Network: Base Sepolia (a free, worthless-by-design practice copy of
 * Coinbase's Base network) — chain id 84532, public RPC
 * https://sepolia.base.org, no account needed to read or submit.
 *
 * Asset: USDC's real Base Sepolia contract, verified directly against the
 * contract itself (not copied from a doc) before writing this file:
 *   name() = "USDC", version() = "2", decimals() = 6 — see PLAN.md. This
 * matters more than it sounds: some real x402 integrations have shipped
 * broken because they assumed the EIP-712 domain name is "USDC" when a
 * contract actually reports "USD Coin" (or vice versa) — a mismatched
 * domain makes every signature fail to verify, silently.
 *
 * One wallet plays two roles on our side: RELAYER_ACCOUNT is both the
 * facilitator's relayer (submits the settlement transaction, pays its own
 * gas) and the merchant's payTo address (receives the payment) — see
 * scripts/gen-charge-keys.mjs. Its private key is a Cloudflare secret
 * (CHARGE_RELAYER_KEY), never committed; its address is public by nature
 * (anyone can see who a blockchain address paid).
 */
import { createPublicClient, createWalletClient, http, parseAbi, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export const NETWORK = "base-sepolia";
export const RPC_URL = "https://sepolia.base.org";
export const USDC_ADDRESS: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;
export const USDC_DOMAIN_NAME = "USDC";
export const USDC_DOMAIN_VERSION = "2";

const USDC_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export function eip712Domain() {
  return {
    name: USDC_DOMAIN_NAME,
    version: USDC_DOMAIN_VERSION,
    chainId: baseSepolia.id,
    verifyingContract: USDC_ADDRESS,
  } as const;
}

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });

export function relayerAccount(privateKey: Hex) {
  return privateKeyToAccount(privateKey);
}

function walletClient(privateKey: Hex) {
  return createWalletClient({ account: relayerAccount(privateKey), chain: baseSepolia, transport: http(RPC_URL) });
}

export async function usdcBalanceOf(address: Address): Promise<bigint> {
  return publicClient.readContract({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf", args: [address] });
}

/** The x402 "accepts" requirement object for one price. */
export interface PaymentRequirement {
  scheme: "exact";
  network: typeof NETWORK;
  maxAmountRequired: string; // atomic units, decimal string
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  asset: Address;
  extra: { name: string; version: string };
}

export function buildRequirement(opts: {
  amountAtomic: bigint;
  resource: string;
  description: string;
  payTo: Address;
}): PaymentRequirement {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: opts.amountAtomic.toString(),
    resource: opts.resource,
    description: opts.description,
    mimeType: "application/json",
    payTo: opts.payTo,
    maxTimeoutSeconds: 300,
    asset: USDC_ADDRESS,
    extra: { name: USDC_DOMAIN_NAME, version: USDC_DOMAIN_VERSION },
  };
}

/** The X-PAYMENT header's decoded shape (client signs and sends this). */
export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: typeof NETWORK;
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

export function decodePaymentHeader(headerValue: string): PaymentPayload | null {
  try {
    const json = atob(headerValue);
    const parsed = JSON.parse(json);
    if (parsed?.payload?.authorization && parsed?.payload?.signature) return parsed;
    return null;
  } catch {
    return null;
  }
}

export type VerifyResult =
  | { ok: true; simulatedRequest: Parameters<typeof publicClient.simulateContract>[0] }
  | { ok: false; reason: "signature-mismatch" | "amount-too-low" | "wrong-payee" | "on-chain-rejected"; detail: string };

/**
 * The facilitator's "verify" step — entirely read-only, zero gas. Checks the
 * signature really was produced by the claimed payer, matches what this
 * resource actually requires, and would succeed on-chain right now (dry-run
 * via eth_call) — catching insufficient balance and an already-used
 * authorization (EIP-3009's own on-chain replay protection) before ever
 * broadcasting anything.
 */
export async function verifyPayment(
  payment: PaymentPayload,
  requirement: PaymentRequirement,
  relayerAddress: Address,
): Promise<VerifyResult> {
  const { authorization, signature } = payment.payload;

  let recovered: Address;
  try {
    recovered = await recoverTypedDataAddress({
      domain: eip712Domain(),
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature,
    });
  } catch (err) {
    return { ok: false, reason: "signature-mismatch", detail: `Could not recover a signer from this signature: ${String((err as Error)?.message ?? err)}` };
  }

  if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
    return { ok: false, reason: "signature-mismatch", detail: `Signature was not produced by the claimed payer (${authorization.from}).` };
  }
  if (authorization.to.toLowerCase() !== relayerAddress.toLowerCase()) {
    return { ok: false, reason: "wrong-payee", detail: `Authorization pays ${authorization.to}, not this resource's payTo (${relayerAddress}).` };
  }
  if (BigInt(authorization.value) < BigInt(requirement.maxAmountRequired)) {
    return { ok: false, reason: "amount-too-low", detail: `Authorized ${authorization.value} atomic units, but ${requirement.maxAmountRequired} is required.` };
  }

  const args = [
    authorization.from,
    authorization.to,
    BigInt(authorization.value),
    BigInt(authorization.validAfter),
    BigInt(authorization.validBefore),
    authorization.nonce,
    // v, r, s split from the 65-byte signature
    ...splitSignature(signature),
  ] as const;

  try {
    const simulated = await publicClient.simulateContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "transferWithAuthorization",
      args,
      account: relayerAddress,
    });
    return { ok: true, simulatedRequest: simulated.request as never };
  } catch (err) {
    return { ok: false, reason: "on-chain-rejected", detail: shortRevertReason(err) };
  }
}

/** The facilitator's "settle" step — only called after verify() passed. Actually
 * broadcasts the transaction (the relayer pays gas) and waits for it to confirm. */
export async function settlePayment(privateKey: Hex, simulatedRequest: unknown) {
  const wallet = walletClient(privateKey);
  const hash = await wallet.writeContract(simulatedRequest as Parameters<typeof wallet.writeContract>[0]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}

function splitSignature(signature: Hex): [number, Hex, Hex] {
  const bytes = signature.slice(2);
  const r = `0x${bytes.slice(0, 64)}` as Hex;
  const s = `0x${bytes.slice(64, 128)}` as Hex;
  let v = parseInt(bytes.slice(128, 130), 16);
  if (v < 27) v += 27; // some signers return {0,1} instead of {27,28}
  return [v, r, s];
}

function shortRevertReason(err: unknown): string {
  const msg = String((err as Error)?.message ?? err);
  const match = msg.match(/reverted with the following reason:\s*([^\n]+)/) || msg.match(/execution reverted:?\s*([^\n"]+)/i);
  return (match?.[1] || msg).trim().slice(0, 200);
}
