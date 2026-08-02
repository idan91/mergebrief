import { describe, expect, it, vi } from "vitest";
import { RepoConfigOutcome, RepoConfigPaths } from "../src/constants";
import { validateRepoConfig } from "../src/validate";
import { instructionsFile, policyFile, settingsFile, yaml } from "./helpers";

describe("validateRepoConfig — outcome table", () => {
  it("returns exactly three outcomes in stable order (instructions, settings, policy)", () => {
    const result = validateRepoConfig({});
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.map((o) => o.path)).toEqual([
      RepoConfigPaths.INSTRUCTIONS,
      RepoConfigPaths.SETTINGS,
      RepoConfigPaths.POLICY,
    ]);
  });

  it("marks every absent file absent with a null blob SHA", () => {
    const result = validateRepoConfig({});
    for (const outcome of result.outcomes) {
      expect(outcome.outcome).toBe(RepoConfigOutcome.ABSENT);
      expect(outcome.blobSha).toBeNull();
    }
    expect(result.settings).toBeUndefined();
    expect(result.policy).toBeUndefined();
    expect(result.instructions).toBeUndefined();
    expect(result.collisions).toEqual([]);
  });

  it("applies all three files on the happy path", () => {
    const result = validateRepoConfig({
      instructions: instructionsFile("# Notes\nGroup db/ together.\n"),
      settings: settingsFile(yaml({ version: 1, entryCommentOnDrafts: true })),
      policy: policyFile(
        yaml({
          version: 1,
          attributes: { "touches-billing": { criteria: "billing change" } },
        }),
      ),
    });
    expect(result.outcomes.map((o) => o.outcome)).toEqual([
      RepoConfigOutcome.APPLIED,
      RepoConfigOutcome.APPLIED,
      RepoConfigOutcome.APPLIED,
    ]);
    expect(result.instructions).toBeDefined();
    expect(result.settings?.entryCommentOnDrafts).toBe(true);
    expect(result.policy?.attributes).toHaveProperty("touches-billing");
    expect(result.outcomes[1]?.blobSha).toBe("sha-fake");
  });

  it("reports the canonical slot path in provenance, not the caller-supplied path", () => {
    const result = validateRepoConfig({
      settings: {
        path: "../evil/elsewhere.yaml",
        content: yaml({ version: 1 }),
        blobSha: "s",
      },
    });
    expect(result.outcomes[1]?.path).toBe(RepoConfigPaths.SETTINGS);
    expect(JSON.stringify(result.outcomes)).not.toContain("evil");
  });

  it("keeps the outcome slot ordering fixed even when only the middle file is present", () => {
    const result = validateRepoConfig({
      settings: settingsFile(yaml({ version: 1 })),
    });
    expect(result.outcomes[0]?.outcome).toBe(RepoConfigOutcome.ABSENT);
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcome.APPLIED);
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcome.ABSENT);
  });
});

describe("validateRepoConfig — prototype pollution resistance", () => {
  // Pins the invariant against a future yaml/zod upgrade regressing their
  // built-in guards. `__proto__`/`constructor` keys must never mutate a
  // prototype, and the strict/charset schemas reject them regardless.
  // A fresh object read at assertion time — reflects any live Object.prototype
  // mutation regardless of when it was created.
  const freshProbe: Record<string, unknown> = {};

  it("does not pollute Object.prototype via a top-level __proto__ key", () => {
    const content = "version: 1\n__proto__:\n  polluted: true\n";
    validateRepoConfig({ settings: settingsFile(content) });
    expect(freshProbe["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("never makes a __proto__ attribute a live custom attribute, and does not pollute", () => {
    // The record parser drops `__proto__` before it can become a definition:
    // attributes end up empty (applied), never a live attribute, no pollution.
    const content =
      "version: 1\nattributes:\n  __proto__:\n    criteria: pwned\n";
    const result = validateRepoConfig({ policy: policyFile(content) });
    expect(freshProbe["criteria"]).toBeUndefined();
    const attrs = result.policy?.attributes;
    // Direct integrity checks (not vacuous): the attributes object's own
    // prototype is untampered, and `criteria` does not resolve via inheritance.
    expect(
      attrs === undefined || Object.getPrototypeOf(attrs) === Object.prototype,
    ).toBe(true);
    expect(attrs?.["criteria"]).toBeUndefined();
    expect(Object.hasOwn(attrs ?? {}, "__proto__")).toBe(false);
    expect(result.collisions).toEqual([]);
  });

  it("rejects a constructor-named attribute (fails safe), with no pollution", () => {
    // Rejection here is INCIDENTAL, not a deliberate guard: yaml attaches the
    // nested value as an own `constructor` property, which shadows the record
    // object's `.constructor`; zod's `isPlainObject` then reads
    // `constructor.prototype` (now undefined) and the record itself throws
    // invalid_type. If a dependency upgrade changes that heuristic this test
    // fails loudly — the fix would be an explicit `constructor`/`prototype`
    // reject in the attribute-name validation, mirroring zod's `__proto__` skip.
    const content =
      "version: 1\nattributes:\n  constructor:\n    criteria: x\n";
    const result = validateRepoConfig({ policy: policyFile(content) });
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcome.INVALID);
    expect(result.policy).toBeUndefined();
    expect(freshProbe["criteria"]).toBeUndefined();
  });
});

describe("validateRepoConfig — error hygiene (no content echo)", () => {
  const CANARY = "SECRET-CANARY-9f3a";

  function assertNoCanary(result: ReturnType<typeof validateRepoConfig>) {
    for (const outcome of result.outcomes) {
      expect(outcome.detail ?? "").not.toContain(CANARY);
      expect(outcome.warning ?? "").not.toContain(CANARY);
      expect(outcome.path).not.toContain(CANARY);
    }
    expect(JSON.stringify(result.outcomes)).not.toContain(CANARY);
  }

  it("does not echo the file's text in a YAML parse error (settings)", () => {
    // Unbalanced brackets + a canary value → yaml throws; detail must be a class message.
    const bad = `version: 1\nentryCommentOnDrafts: [${CANARY}\nbroken: {${CANARY}`;
    const result = validateRepoConfig({ settings: settingsFile(bad) });
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcome.INVALID);
    expect(result.outcomes[1]?.detail).toBe("not valid YAML");
    assertNoCanary(result);
  });

  it("does not echo the file's text in a YAML parse error (policy)", () => {
    const bad = `version: 1\nattributes:\n  my-attr:\n    criteria: "${CANARY}\n  : : :`;
    const result = validateRepoConfig({ policy: policyFile(bad) });
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcome.INVALID);
    assertNoCanary(result);
  });

  it("does not echo values or key names in a schema-invalid error", () => {
    // A canary as an unknown key name and as a value — neither may surface.
    const content = yaml({
      version: 1,
      [CANARY]: CANARY,
      entryCommentOnDrafts: false,
    });
    const result = validateRepoConfig({ settings: settingsFile(content) });
    expect(result.outcomes[1]?.outcome).toBe(RepoConfigOutcome.INVALID);
    assertNoCanary(result);
  });

  it("suppresses the YAML parser's warning channel (no source echo to process warnings)", () => {
    // At the default log level, an unresolved tag makes the yaml lib emit the
    // offending source line via process.emitWarning — a content leak. The parse
    // must run silent.
    const emitted: string[] = [];
    const spy = vi
      .spyOn(process, "emitWarning")
      .mockImplementation((warning: string | Error) => {
        emitted.push(typeof warning === "string" ? warning : warning.message);
      });
    const content = `version: 1\nattributes:\n  a: !customtag ${CANARY}\n`;
    validateRepoConfig({ policy: policyFile(content) });
    spy.mockRestore();
    expect(emitted.join("")).not.toContain(CANARY);
  });

  it("does not echo an off-charset attribute NAME via a policy invalid_key path", () => {
    // Zod's invalid_key issue carries the raw record key in its path; the
    // sanitized detail must not surface it.
    const content = yaml({
      version: 1,
      attributes: { [CANARY]: { criteria: "x" } },
    });
    const result = validateRepoConfig({ policy: policyFile(content) });
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcome.INVALID);
    assertNoCanary(result);
  });

  it("does not echo an attribute NAME that collides with a safe path-segment word", () => {
    // `criteria` is a valid custom attribute name AND a structural field word;
    // at the record-key position it must still be redacted.
    const content = yaml({
      version: 1,
      attributes: { criteria: { criteria: "" } },
    });
    const result = validateRepoConfig({ policy: policyFile(content) });
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcome.INVALID);
    expect(result.outcomes[2]?.detail ?? "").not.toContain(
      "attributes.criteria.criteria",
    );
  });

  it("does not echo a valid attribute NAME via a nested policy issue path", () => {
    // A well-formed (charset-valid) custom name is still author YAML content:
    // a nested criteria failure must not leak the name into detail.
    const name = "my-secretish-attr";
    const content = yaml({
      version: 1,
      attributes: { [name]: { criteria: "" } }, // empty criteria fails min(1)
    });
    const result = validateRepoConfig({ policy: policyFile(content) });
    expect(result.outcomes[2]?.outcome).toBe(RepoConfigOutcome.INVALID);
    expect(result.outcomes[2]?.detail ?? "").not.toContain(name);
  });
});
