// The CLI-mapping gate: every operation maps to a command the real program
// registers, an unexpired fully-documented gap, or a reasoned web-only note;
// every map key names an operation in the table.
import { describe, expect, it } from "vitest";
import {
  checkOperationsMap,
  type CheckOperationsMapInput,
} from "../scripts/operations-map-lib";

const PATHS = new Set(["thing", "auth", "auth login"]);

function check(
  input: Partial<CheckOperationsMapInput> & {
    readonly operationIds: readonly string[];
    readonly mapRaw: string;
  },
): ReturnType<typeof checkOperationsMap> {
  return checkOperationsMap({
    today: "2026-08-16",
    commandPaths: PATHS,
    ...input,
  });
}

function formatErrors(result: ReturnType<typeof checkOperationsMap>): string {
  return result.ok ? "" : result.error.join("\n");
}

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
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({ "read-thing": { command: "mergebrief thing" } }),
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an unexpired, fully-documented gap", () => {
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({ "read-thing": { gap: GAP } }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an operation with no entry", () => {
    const result = check({ operationIds: ["read-thing"], mapRaw: "{}" });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/read-thing/);
  });

  it("rejects an expired gap", () => {
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-08-15" } },
      }),
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/expired/);
  });

  it("accepts a gap expiring today", () => {
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-08-16" } },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an impossible calendar date as expiry", () => {
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({
        "read-thing": { gap: { ...GAP, expiry: "2026-13-01" } },
      }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a gap missing a required field", () => {
    const { ticket: _ticket, ...incomplete } = GAP;
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({ "read-thing": { gap: incomplete } }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a map key that names no operation", () => {
    const result = check({
      operationIds: ["read-thing"],
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
      operationIds: ["mint-secret"],
      mapRaw: JSON.stringify({ "mint-secret": { webOnly: WEB_ONLY } }),
    });
    expect(result).toEqual({
      ok: true,
      value: { commands: 0, gaps: 0, webOnly: 1 },
    });
  });

  it("rejects a web-only operation with no entry", () => {
    const result = check({
      operationIds: ["mint-secret"],
      mapRaw: "{}",
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/mint-secret/);
  });

  it("rejects a web-only entry missing its reason", () => {
    const result = check({
      operationIds: ["mint-secret"],
      mapRaw: JSON.stringify({ "mint-secret": { webOnly: { owner: "idan" } } }),
    });
    expect(result.ok).toBe(false);
  });

  it("reports schema problems one issue per line", () => {
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({ "read-thing": { command: "" } }),
    });
    expect(result.ok).toBe(false);
    const errors = result.ok ? [] : result.error;
    expect(errors.every((line) => !line.includes("\n"))).toBe(true);
    expect(errors[0]).toMatch(/^operations map: /);
  });

  it("rejects malformed JSON with a parse error, not a throw", () => {
    const result = check({ operationIds: ["read-thing"], mapRaw: "not json" });
    expect(result.ok).toBe(false);
  });

  it("does not read the prototype chain for a colliding operation id", () => {
    const result = check({
      operationIds: ["constructor"],
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
      operationIds: ["read-thing"],
      mapRaw: `{"read-thing": ${entry}, "read-thing": ${entry}}`,
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/duplicate key "read-thing"/);
  });

  it("does not mistake a nested key for a duplicate top-level key", () => {
    const result = check({
      operationIds: ["read-thing", "read-other"],
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
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief auth login" },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("ignores argument placeholders when resolving the path", () => {
    const result = check({
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({
        "read-thing": { command: "mergebrief thing <number> [extra]" },
      }),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a command the CLI does not register", () => {
    const result = check({
      operationIds: ["read-thing"],
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
      operationIds: ["read-thing"],
      mapRaw: JSON.stringify({ "read-thing": { command: "thing <number>" } }),
    });
    expect(result.ok).toBe(false);
    expect(formatErrors(result)).toMatch(/must start with "mergebrief"/);
  });
});
