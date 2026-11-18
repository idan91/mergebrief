import { describe, expect, it } from "vitest";

import { readHeadingSlugs, slugifyHeading } from "../../src/anchors/slug";

describe("slugifyHeading", () => {
  it.each([
    ["Verifying / troubleshooting", "verifying--troubleshooting"],
    [
      "External database: auto-migrate=false",
      "external-database-auto-migratefalse",
    ],
    [
      "2. Terminate TLS at a reverse proxy",
      "2-terminate-tls-at-a-reverse-proxy",
    ],
    [
      "Identity / secrets (all env, never the DB or repo)",
      "identity--secrets-all-env-never-the-db-or-repo",
    ],
    ["IdP / SSO proxies: exempt /api/*", "idp--sso-proxies-exempt-api"],
    [
      "The browser refuses the __Host- cookie",
      "the-browser-refuses-the-__host--cookie",
    ],
    [
      "Instance config (mergebrief.config.yaml)",
      "instance-config-mergebriefconfigyaml",
    ],
    ["Vision & Charter", "vision--charter"],
  ])("slugs %j the way GitHub does", (heading, slug) => {
    expect(slugifyHeading(heading)).toBe(slug);
  });
});

describe("readHeadingSlugs", () => {
  it("numbers a repeated heading the way GitHub does", () => {
    const markdown = "# Setup\n\n## Usage\n\n## Usage\n\n### `Usage`\n";

    expect([...readHeadingSlugs(markdown)]).toEqual([
      "setup",
      "usage",
      "usage-1",
      "usage-2",
    ]);
  });
});
