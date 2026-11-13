/**
 * Invariants:
 * - the block is a list of typed entries, one per type: `notion` or `jira`
 * - `tokenEnv` is an env-var NAME; a pasted value refuses the file without
 *   being echoed
 * - unknown keys and unknown types are named through the key gate
 * - the failure carries the context-source message, not the generator's
 */
import { describe, expect, it } from "vitest";
import { validateContextSourcesBlock } from "../src/config/context-sources";

describe("validateContextSourcesBlock", () => {
  it("accepts an empty list and a notion entry with or without tokenEnv", () => {
    expect(validateContextSourcesBlock([])).toEqual({ ok: true, value: [] });
    expect(validateContextSourcesBlock([{ type: "notion" }])).toEqual({
      ok: true,
      value: [{ type: "notion" }],
    });
    expect(
      validateContextSourcesBlock([{ type: "notion", tokenEnv: "MY_VAR" }]),
    ).toEqual({ ok: true, value: [{ type: "notion", tokenEnv: "MY_VAR" }] });
  });

  it("refuses a second entry of the same type, naming the field", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", tokenEnv: "NOTION_ONE" },
      { type: "notion", tokenEnv: "NOTION_TWO" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).toContain(
      'contextSources.1."type": duplicate entry of type "notion"',
    );
  });

  it("refuses a non-list block", () => {
    const result = validateContextSourcesBlock({ type: "notion" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toBe("invalid context source configuration");
    expect(result.error.issues[0]).toMatch(/^contextSources: /);
  });

  it("names an unknown type with the vocabulary, redacting secret shapes", () => {
    const linear = validateContextSourcesBlock([{ type: "linear" }]);
    expect(linear.ok).toBe(false);
    if (linear.ok) {
      return;
    }
    expect(linear.error.issues.join("; ")).toContain(
      'unknown type (valid: notion, jira); got "linear"',
    );

    const pasted = validateContextSourcesBlock([
      { type: "ntn_1234567890abcdef" },
    ]);
    expect(pasted.ok).toBe(false);
    if (pasted.ok) {
      return;
    }
    const text = pasted.error.issues.join("; ");
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("ntn_");
  });

  it("refuses a tokenEnv that is a value, not a NAME, without echoing it", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", tokenEnv: "ntn_secret-with-dash" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain("contextSources.0.");
    expect(text).toContain("environment variable NAME");
    expect(text).not.toContain("ntn_secret");
  });

  it("refuses a lowercase token pasted as tokenEnv, the realistic paste", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", tokenEnv: "ntn_1234567890abcdef" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues.join("; ")).not.toContain("ntn_");
  });

  it("refuses unknown entry keys through the key gate", () => {
    const result = validateContextSourcesBlock([
      { type: "notion", token: "x", ntn_abc123: "y" },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    const text = result.error.issues.join("; ");
    expect(text).toContain('"token"');
    expect(text).toContain("(redacted)");
    expect(text).not.toContain("ntn_abc");
  });
});

const JIRA_ENTRY = { type: "jira", site: "acme.atlassian.net" } as const;
const JIRA_TOKEN_VALUE = "ATATT3xFfGF0abcDEF123_ghiJKL456=9A8B7C6D";

function readIssues(block: unknown): string {
  const result = validateContextSourcesBlock(block);
  if (result.ok) {
    throw new Error("expected a refusal");
  }
  return result.error.issues.join("; ");
}

describe("validateContextSourcesBlock: jira", () => {
  it("accepts a site alone, stored lower-case", () => {
    expect(
      validateContextSourcesBlock([
        { type: "jira", site: "Acme.Atlassian.NET" },
      ]),
    ).toEqual({ ok: true, value: [JIRA_ENTRY] });
  });

  it("accepts every field and a jira entry beside a notion one", () => {
    const entry = {
      ...JIRA_ENTRY,
      emailEnv: "JIRA_BOT_EMAIL",
      tokenEnv: "JIRA_BOT_TOKEN",
      linkHosts: ["Jira.Acme.com", "tickets.acme.io"],
    };
    expect(validateContextSourcesBlock([{ type: "notion" }, entry])).toEqual({
      ok: true,
      value: [
        { type: "notion" },
        { ...entry, linkHosts: ["jira.acme.com", "tickets.acme.io"] },
      ],
    });
  });

  it("refuses an entry with no site", () => {
    expect(readIssues([{ type: "jira" }])).toContain('contextSources.0."site"');
  });

  it.each([
    ["a scheme", "https://acme.atlassian.net"],
    ["a path", "acme.atlassian.net/browse"],
    ["a port", "acme.atlassian.net:443"],
    ["userinfo", "dana:secret@acme.atlassian.net"],
    ["another domain", "jira.acme.com"],
    ["a nested label", "eu.acme.atlassian.net"],
    ["the bare domain", "ATLASSIAN.NET"],
  ])("refuses a site with %s without echoing it", (_label, site) => {
    const text = readIssues([{ type: "jira", site }]);
    expect(text).toContain('contextSources.0."site"');
    expect(text).not.toContain(site);
  });

  it("refuses an email pasted as emailEnv without echoing it", () => {
    const text = readIssues([{ ...JIRA_ENTRY, emailEnv: "dana@acme.com" }]);
    expect(text).toContain('contextSources.0."emailEnv"');
    expect(text).toContain("environment variable NAME");
    expect(text).not.toContain("dana@");
  });

  it("refuses a token pasted as tokenEnv without echoing it", () => {
    const text = readIssues([{ ...JIRA_ENTRY, tokenEnv: JIRA_TOKEN_VALUE }]);
    expect(text).toContain('contextSources.0."tokenEnv"');
    expect(text).not.toContain("ATATT");
  });

  it.each(["cloudId", "email", "token"])(
    "refuses the unknown key %s",
    (key) => {
      expect(readIssues([{ ...JIRA_ENTRY, [key]: "x" }])).toContain(`"${key}"`);
    },
  );

  it.each([
    ["an atlassian.net host", ["acme-old.atlassian.net"]],
    ["a URL", ["https://jira.acme.com"]],
    ["a host with a port", ["jira.acme.com:8443"]],
    ["a repeat in any case", ["jira.acme.com", "JIRA.acme.com"]],
    ["more than four hosts", ["a.io", "b.io", "c.io", "d.io", "e.io"]],
  ])("refuses linkHosts holding %s without echoing it", (_label, hosts) => {
    const text = readIssues([{ ...JIRA_ENTRY, linkHosts: hosts }]);
    expect(text).toContain('contextSources.0."linkHosts"');
    expect(text).not.toContain(hosts[0]);
  });
});
