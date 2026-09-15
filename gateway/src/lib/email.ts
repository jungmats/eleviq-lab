/**
 * Real email delivery for Demo 3 (Delegate) — sends the one-time code via
 * Resend. This is the only place the code leaves the server; no response
 * body ever includes it (see routes/delegate-request-code.ts).
 *
 * Sender domain (`lab.eleviq.solutions`) is verified in Resend separately —
 * not something this Worker can do for itself. See README.md for the setup
 * steps (DNS records + `wrangler secret put RESEND_API_KEY`).
 */
import type { Env } from "./env";

const FROM = "ElevIQ Lab <delegate@lab.eleviq.solutions>";
const RESEND_URL = "https://api.resend.com/emails";

export type SendResult = { ok: true } | { ok: false; detail: string };

export async function sendDelegationCode(env: Env, to: string, code: string): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: "Your ElevIQ Lab delegation code",
        text: [
          code,
          "",
          `This code proves an agent is acting for this inbox in the ElevIQ Lab "Delegate" demo (lab.eleviq.solutions/delegate/). It expires in 5 minutes and works once.`,
          "",
          "Didn't request this? Ignore it — nothing happens without the code.",
        ].join("\n"),
      }),
    });
  } catch (err) {
    return { ok: false, detail: `Could not reach the email provider: ${String((err as Error)?.message ?? err)}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, detail: `Email provider rejected the send (${res.status}): ${body.slice(0, 200)}` };
  }
  return { ok: true };
}
