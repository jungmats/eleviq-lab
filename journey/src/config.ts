/**
 * Everything a deployment is expected to change, in one place — same idea as
 * site-logger/src/config.ts. A customer deployment edits this file and the
 * journey definitions, nothing else.
 */
export const config = {
  /** Where problem+json `type` links and the demo page point. */
  site: "https://lab.eleviq.solutions/journey/",

  /** Event sinks. D1 is the dashboard's source; the webhook forwards every
   * event as JSON to the customer's own analytics. */
  sinks: {
    d1: true,
    webhook: {
      enabled: false,
      url: "",
      /** Sent as `Authorization: Bearer <JOURNEY_WEBHOOK_SECRET>` when that secret is set. */
    },
  },

  analytics: {
    /** Lab: public (no personal data is stored). Customer: put /dashboard/
     * and /api/analytics/ behind Cloudflare Access instead of flipping this. */
    enabled: true,
    /** Upper bound on journeys aggregated per request. */
    maxJourneys: 2000,
    listLimit: 100,
  },

  userBinding: {
    /** DEMO: the verification code comes back in the response instead of
     * being emailed. A customer deployment sends it via their own channel. */
    returnCodeDirectly: true,
  },

  /** Reject request bodies larger than this. */
  maxBodyBytes: 32_000,
} as const;
