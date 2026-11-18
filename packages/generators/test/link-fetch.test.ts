import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateLinkFetchBlock } from "../src/config/link-fetch";
import { LinkFetchModes } from "../src/config/link-fetch/types";
import { loadGeneratorConfigFile } from "../src/config/loader";

const tempDirs: string[] = [];
function writeConfigFile(contents: string): string {
  const prefix = join(tmpdir(), "mergebrief-link-fetch-");
  const dir = mkdtempSync(prefix);
  tempDirs.push(dir);
  const path = join(dir, "mergebrief.config.yaml");
  writeFileSync(path, contents);
  return path;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readIssues(block: unknown): string {
  const result = validateLinkFetchBlock(block);
  if (result.ok) {
    return "";
  }
  return result.error.issues.join("; ");
}

describe("validateLinkFetchBlock", () => {
  it.each([LinkFetchModes.PUBLIC, LinkFetchModes.OFF])(
    "parses the %s mode with no hosts",
    (mode) => {
      expect(validateLinkFetchBlock({ mode })).toEqual({
        ok: true,
        value: { mode, hosts: [], maxTotalChars: 40_000 },
      });
    },
  );

  it("defaults an empty block to public", () => {
    expect(validateLinkFetchBlock({})).toEqual({
      ok: true,
      value: { mode: LinkFetchModes.PUBLIC, hosts: [], maxTotalChars: 40_000 },
    });
  });

  it("parses an allowlist of exact hostnames", () => {
    const result = validateLinkFetchBlock({
      mode: "allowlist",
      hosts: ["docs.example.com", "wiki.example.org"],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        mode: LinkFetchModes.ALLOWLIST,
        hosts: ["docs.example.com", "wiki.example.org"],
        maxTotalChars: 40_000,
      },
    });
  });

  it("refuses an unknown mode and names the field", () => {
    expect(readIssues({ mode: "private" })).toBe(
      'linkFetch: "mode": must be one of public, off, allowlist',
    );
  });

  it("refuses an allowlist with no hosts", () => {
    expect(readIssues({ mode: "allowlist" })).toBe(
      'linkFetch: "hosts": the allowlist mode needs at least one host',
    );
    expect(readIssues({ mode: "allowlist", hosts: [] })).toBe(
      'linkFetch: "hosts": the allowlist mode needs at least one host',
    );
  });

  it("refuses hosts outside the allowlist mode", () => {
    expect(readIssues({ mode: "public", hosts: ["docs.example.com"] })).toBe(
      'linkFetch: "hosts": only the allowlist mode takes hosts',
    );
  });

  it.each([
    "*.example.com",
    "Docs.Example.com",
    "https://docs.example.com",
    "docs.example.com:443",
    "docs.example.com/path",
    "",
    "docs..example.com",
  ])("refuses %j as a host without echoing it", (host) => {
    const issues = readIssues({ mode: "allowlist", hosts: [host] });
    expect(issues).toBe(
      'linkFetch: "hosts".0: must be an exact lowercase hostname, no scheme, port, path or wildcard',
    );
  });

  it("refuses an unrecognized key", () => {
    expect(readIssues({ mode: "off", budget: 1 })).toContain(
      'linkFetch: unrecognized key "budget"',
    );
  });

  it.each(["off", null, ["public"]])("refuses %j as the block", (block) => {
    expect(readIssues(block)).toBe("linkFetch: must be a mapping");
  });
});

describe("the linkFetch root key", () => {
  it("defaults to public when the file has no linkFetch block", () => {
    const loaded = loadGeneratorConfigFile(
      writeConfigFile("generator:\n  provider: anthropic\n"),
    );
    expect(loaded.ok && loaded.value.linkFetch).toEqual({
      mode: LinkFetchModes.PUBLIC,
      hosts: [],
      maxTotalChars: 40_000,
    });
  });

  it("loads an allowlist block", () => {
    const loaded = loadGeneratorConfigFile(
      writeConfigFile(
        "linkFetch:\n  mode: allowlist\n  hosts:\n    - docs.example.com\n",
      ),
    );
    expect(loaded.ok && loaded.value.linkFetch).toEqual({
      mode: LinkFetchModes.ALLOWLIST,
      hosts: ["docs.example.com"],
      maxTotalChars: 40_000,
    });
  });

  it("refuses boot on a bad linkFetch block", () => {
    const loaded = loadGeneratorConfigFile(
      writeConfigFile("linkFetch:\n  mode: everything\n"),
    );
    expect(loaded.ok).toBe(false);
    if (loaded.ok) {
      return;
    }
    expect(loaded.error.issues).toEqual([
      'linkFetch: "mode": must be one of public, off, allowlist',
    ]);
  });
});

describe("the linked text budget", () => {
  it("defaults to 40,000 characters", () => {
    const result = validateLinkFetchBlock({});

    expect(result.ok && result.value.maxTotalChars).toBe(40_000);
  });

  it("takes an operator's own budget", () => {
    const result = validateLinkFetchBlock({ maxTotalChars: 12_000 });

    expect(result.ok && result.value.maxTotalChars).toBe(12_000);
  });

  it.each([0, -1, 1.5, "40000"])("refuses a budget of %j", (maxTotalChars) => {
    expect(readIssues({ maxTotalChars })).toContain("maxTotalChars");
  });
});
