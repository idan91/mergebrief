// The CLI-mapping gate: every agent-available operation maps to a command the
// real program registers, or to an unexpired, fully-documented gap; every map
// key exists in the manifest; web-only operations stay out of the map. The
// last tests run the REAL committed files and the REAL command tree through
// the same check the lint gate uses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cliCommandPaths } from "../scripts/command-paths";
import {
  checkOperationsMap,
  type CheckOperationsMapInput,
} from "../scripts/operations-map-lib";

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

function manifestOf(operations: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ operations });
}

function errorsOf(result: ReturnType<typeof checkOperationsMap>): string {
  return result.ok ? "" : result.error.join("\n");
}

const QUERY = {
  id: "read-thing",
  kind: "query",
  classification: "read",
  agentAvailable: true,
  endpoint: "GET /api/thing",
};
const WEB_ONLY = {
  id: "mint-secret",
  kind: "action",
  classification: "private-write",
  agentAvailable: false,
  endpoint: "POST /api/secrets",
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
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { command: "mergebrief thing" } }),
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an unexpired, fully-documented gap", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { gap: GAP } }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an agent-available operation with no entry", () => {
    const result = check({ manifestRaw: manifestOf([QUERY]), mapRaw: "{}" });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/read-thing/);
  });

  it("rejects an expired gap", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-08-15" } },
      }),
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/expired/);
  });

  it("accepts a gap expiring today", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-08-16" } },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an impossible calendar date as expiry", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-13-01" } },
      }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a gap missing a required field", () => {
    const { ticket: _ticket, ...incomplete } = GAP;
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { gap: incomplete } }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a map key absent from the manifest", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief thing" },
        "ghost-op": { command: "mergebrief thing" },
      }),
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/ghost-op/);
  });

  it("rejects a web-only operation appearing in the map", () => {
    const result = check({
      manifestRaw: manifestOf([WEB_ONLY]),
      mapRaw: JSON.stringify({
        "mint-secret": { command: "mergebrief thing" },
      }),
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/mint-secret/);
  });

  it("web-only operations need no entry", () => {
    const result = check({ manifestRaw: manifestOf([WEB_ONLY]), mapRaw: "{}" });
    expect(result.ok).toBe(true);
  });

  it("rejects a manifest endpoint that is not `METHOD /api/...`", () => {
    const result = check({
      manifestRaw: manifestOf([{ ...QUERY, endpoint: "GET /thing" }]),
      mapRaw: JSON.stringify({ "read-thing": { command: "mergebrief thing" } }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a manifest with no operations", () => {
    const result = check({ manifestRaw: manifestOf([]), mapRaw: "{}" });
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.join("\n")).toContain("manifest lists no product operations");
  });

  it("reports schema problems one issue per line", () => {
    const result = check({
      manifestRaw: manifestOf([{ ...QUERY, endpoint: "GET /thing" }]),
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
      manifestRaw: manifestOf([{ ...QUERY, id: "constructor" }]),
      mapRaw: "{}",
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(
      /"constructor" has no CLI command and no documented gap entry/,
    );
  });

  it("rejects a duplicate top-level key in the map", () => {
    const entry = '{"command":"mergebrief thing"}';
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: `{"read-thing": ${entry}, "read-thing": ${entry}}`,
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/duplicate key "read-thing"/);
  });

  it("does not mistake a nested key for a duplicate top-level key", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY, { ...QUERY, id: "read-other" }]),
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
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief auth login" },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("ignores argument placeholders when resolving the path", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief thing <number> [extra]" },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a command the CLI does not register", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief renamed <number>" },
      }),
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(
      /"read-thing" command "mergebrief renamed <number>" is not a registered CLI command/,
    );
  });

  it("rejects a command string missing the binary name", () => {
    const result = check({
      manifestRaw: manifestOf([QUERY]),
      mapRaw: JSON.stringify({ "read-thing": { command: "thing <number>" } }),
    });
    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toMatch(/must start with "mergebrief"/);
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
    expect(result).toEqual({ ok: true, value: expect.anything() });
  });
});
