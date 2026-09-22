// The CLI-mapping gate: every operation maps to a command the real program
// registers, an unexpired fully-documented gap, or a reasoned web-only note;
// every map key exists in the manifest. The last tests run the REAL committed
// files and the REAL command tree through the same check the lint gate uses.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cliCommandPaths } from "../scripts/command-paths";
import {
  checkOperationsMap,
  renderCatalogFingerprintModule,
  type CheckOperationsMapInput,
} from "../scripts/operations-map-lib";
import { CLI_CATALOG_FINGERPRINT } from "../src/generated-catalog-fingerprint";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));

const PATHS = new Set(["thing", "auth", "auth login"]);

function check(
  input: Partial<CheckOperationsMapInput> & {
    readonly manifestRaw: string;
    readonly mapRaw: string;
  },
): ReturnType<typeof checkOperationsMap> {
  return checkOperationsMap({
    today: "2026-08-16",
    commandPaths: PATHS,
    ...input,
  });
}

function buildManifest(operations: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ operations });
}

function formatErrors(result: ReturnType<typeof checkOperationsMap>): string {
  return result.ok ? "" : result.error.join("\n");
}

const QUERY = {
  id: "read-thing",
  kind: "query",
  classification: "read",
  endpoint: "GET /api/thing",
};
const WEB_ONLY_OPERATION = {
  id: "mint-secret",
  kind: "action",
  classification: "private-write",
  endpoint: "POST /api/secrets",
};
const WEB_ONLY = {
  reason: "credential minting is a browser act",
  owner: "idan",
};
const GAP = {
  reason: "no command yet",
  owner: "idan",
  ticket: "BRIEF-197",
  expiry: "2099-01-01",
};

describe("checkOperationsMap", () => {
  it("accepts a complete mapping", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { command: "mergebrief thing" } }),
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an unexpired, fully-documented gap", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { gap: GAP } }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an operation with no entry", () => {
    const result = check({ manifestRaw: buildManifest([QUERY]), mapRaw: "{}" });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/read-thing/);
  });

  it("rejects an expired gap", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-08-15" } },
      }),
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/expired/);
  });

  it("accepts a gap expiring today", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-08-16" } },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an impossible calendar date as expiry", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-13-01" } },
      }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a gap missing a required field", () => {
    const { ticket: _ticket, ...incomplete } = GAP;
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { gap: incomplete } }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a map key absent from the manifest", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief thing" },
        "ghost-op": { command: "mergebrief thing" },
      }),
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/ghost-op/);
  });

  it("accepts a reasoned web-only entry", () => {
    const result = check({
      manifestRaw: buildManifest([WEB_ONLY_OPERATION]),
      mapRaw: JSON.stringify({ "mint-secret": { webOnly: WEB_ONLY } }),
    });
    expect(result).toEqual({
      ok: true,
      value: { commands: 0, gaps: 0, webOnly: 1 },
    });
  });

  it("rejects a web-only operation with no entry", () => {
    const result = check({
      manifestRaw: buildManifest([WEB_ONLY_OPERATION]),
      mapRaw: "{}",
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/mint-secret/);
  });

  it("rejects a web-only entry missing its reason", () => {
    const result = check({
      manifestRaw: buildManifest([WEB_ONLY_OPERATION]),
      mapRaw: JSON.stringify({ "mint-secret": { webOnly: { owner: "idan" } } }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest endpoint that is not `METHOD /api/...`", () => {
    const result = check({
      manifestRaw: buildManifest([{ ...QUERY, endpoint: "GET /thing" }]),
      mapRaw: JSON.stringify({ "read-thing": { command: "mergebrief thing" } }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest with no operations", () => {
    const result = check({ manifestRaw: buildManifest([]), mapRaw: "{}" });
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.join("\n")).toContain("manifest lists no product operations");
  });

  it("reports schema problems one issue per line", () => {
    const result = check({
      manifestRaw: buildManifest([{ ...QUERY, endpoint: "GET /thing" }]),
      mapRaw: JSON.stringify({ "read-thing": { command: "mergebrief thing" } }),
    });
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.every((line) => !line.includes("\n"))).toBe(true);
    expect(errors[0]).toMatch(/^manifest: operations\.0\.endpoint: /);
  });

  it("rejects malformed JSON with a parse error, not a throw", () => {
    const result = check({ manifestRaw: "not json", mapRaw: "{}" });
    expect(result.ok).toBe(false);
  });

  it("does not read the prototype chain for a colliding operation id", () => {
    const result = check({
      manifestRaw: buildManifest([{ ...QUERY, id: "constructor" }]),
      mapRaw: "{}",
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(
      /"constructor" has no CLI command, documented gap, or web-only entry/,
    );
  });

  it("rejects a duplicate top-level key in the map", () => {
    const entry = '{"command":"mergebrief thing"}';
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: `{"read-thing": ${entry}, "read-thing": ${entry}}`,
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/duplicate key "read-thing"/);
  });

  it("does not mistake a nested key for a duplicate top-level key", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY, { ...QUERY, id: "read-other" }]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, reason: 'a } brace and " quote' } },
        "read-other": { gap: GAP },
      }),
    });
    expect(result.ok).toBe(true);
  });
});

describe("command validation", () => {
  it("resolves a subcommand path", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief auth login" },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("ignores argument placeholders when resolving the path", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief thing <number> [extra]" },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a command the CLI does not register", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief renamed <number>" },
      }),
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(
      /"read-thing" command "mergebrief renamed <number>" is not a registered CLI command/,
    );
  });

  it("rejects a command string missing the binary name", () => {
    const result = check({
      manifestRaw: buildManifest([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { command: "thing <number>" } }),
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/must start with "mergebrief"/);
  });
});

describe("cliCommandPaths", () => {
  it("enumerates the real program's commands and subcommands", () => {
    const paths = cliCommandPaths();
    expect(paths.has("pr")).toBe(true);
    expect(paths.has("repos")).toBe(true);
    expect(paths.has("auth")).toBe(true);
    expect(paths.has("auth login")).toBe(true);
    expect(paths.has("renamed")).toBe(false);
  });
});

describe("the committed catalog", () => {
  it("passes the gate against the real command tree", () => {
    const result = checkOperationsMap({
      manifestRaw: readFileSync(
        join(PKG_ROOT, "..", "api", "product-operations.manifest.json"),
        "utf8",
      ),
      mapRaw: readFileSync(
        join(PKG_ROOT, "product-operations.map.json"),
        "utf8",
      ),
      today: "2026-08-16",
      commandPaths: cliCommandPaths(),
    });
    // The catalog's final shape: every operation accounted for.
    expect(result).toEqual({
      ok: true,
      value: { commands: 29, gaps: 0, webOnly: 8 },
    });
  });
});

describe("the baked catalog fingerprint", () => {
  it("renders a module exporting the manifest bytes' sha256", () => {
    const manifestRaw = '{"operations":[]}\n';
    expect(renderCatalogFingerprintModule(manifestRaw)).toBe(
      "// Generated by `pnpm map:check --write`: the sha256 of the api\n" +
        "// manifest this package's operations map was checked against.\n" +
        "// Do not edit by hand.\n" +
        "export const CLI_CATALOG_FINGERPRINT =\n" +
        `  "${createHash("sha256").update(manifestRaw).digest("hex")}";\n`,
    );
  });

  it("committed module matches the committed manifest", () => {
    const manifestRaw = readFileSync(
      join(PKG_ROOT, "..", "api", "product-operations.manifest.json"),
      "utf8",
    );
    const committed = readFileSync(
      join(PKG_ROOT, "src", "generated-catalog-fingerprint.ts"),
      "utf8",
    );
    expect(committed).toBe(renderCatalogFingerprintModule(manifestRaw));
    expect(CLI_CATALOG_FINGERPRINT).toBe(
      createHash("sha256").update(manifestRaw).digest("hex"),
    );
  });
});
