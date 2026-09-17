/**
 * Per-deployment configuration for this Worker's features (see
 * features/*). A different client engagement reusing this Worker as a
 * template should only need to edit this file — enable/disable a feature,
 * or change its settings — not the feature modules themselves.
 */

export interface DiscoveryLink {
  /** Link relation, e.g. "sitemap", "describedby", "api-catalog". */
  rel: string;
  /** Root-relative path the relation points at, e.g. "/sitemap.xml". */
  path: string;
}

export interface SiteConfig {
  markdown: {
    /** Serve text/markdown when a request negotiates for it (checklist 2.10). */
    enabled: boolean;
  };
  linkHeaders: {
    /** Add RFC 8288 `Link` discovery headers (checklist 1.9). */
    enabled: boolean;
    links: DiscoveryLink[];
  };
  logging: {
    /** Anonymous visitor logging — see features/logging/. */
    enabled: boolean;
  };
}

export const config: SiteConfig = {
  markdown: {
    enabled: true,
  },
  linkHeaders: {
    enabled: true,
    links: [
      { rel: "sitemap", path: "/sitemap.xml" },
      { rel: "describedby", path: "/llms.txt" },
    ],
  },
  logging: {
    enabled: true,
  },
};
