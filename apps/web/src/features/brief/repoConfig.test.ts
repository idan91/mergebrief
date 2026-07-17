// BRIEF-52 repo-config snapshot support: wire parsing (the /brief-context
// envelope), display-weight resolution (source, de-emphasis, floor co-fire),
// and the LOCKSTEP pins — the FE's mirrored floor list and glob matcher must
// never drift from their sources (repo-config / categorizer, imported here
// at dev time only; the app bundle never imports those packages).
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_NAME_MAX_CHARS,
  ATTRIBUTE_NAME_PATTERN,
  CRITERIA_MAX_CHARS as SOURCE_CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES as SOURCE_FLOOR_ATTRIBUTES,
  IMPLICATION_MAX_CHARS as SOURCE_IMPLICATION_MAX_CHARS,
  RepoConfigOutcome,
  RepoConfigPaths,
} from "repo-config";
import { matchesGlob as sourceMatchesGlob } from "categorizer";
import {
  attributeDisplayMeta,
  CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES,
  floorFirst,
  IMPLICATION_MAX_CHARS,
  matchesGlob,
  NAME_MAX_CHARS,
  NAME_PATTERN,
  OUTCOMES,
  parseBriefContext,
  SLOT_PATHS,
  type RepoConfigContext,
} from "./repoConfig";

const SNAPSHOT: RepoConfigContext = {
  files: [
    { path: ".mergebrief/instructions.md", blobSha: "i", outcome: "applied" },
    { path: ".mergebrief/settings.yaml", blobSha: null, outcome: "absent" },
    { path: ".mergebrief/policy.yaml", blobSha: "p", outcome: "applied" },
  ],
  collisions: ["touches-auth"],
  policy: {
    firedCustomAttributes: [
      {
        name: "touches-billing",
        criteria: "modifies invoicing code",
        implication: "needs finance review",
        paths: ["services/billing/**"],
      },
    ],
    deEmphasize: [
      { attribute: "widens-error-handling" },
      { attribute: "no-tests", paths: ["generated/**"] },
    ],
  },
};

describe("parseBriefContext", () => {
  it("parses a full envelope round-trip", () => {
    const parsed = parseBriefContext({ repoConfig: SNAPSHOT });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value).toEqual(SNAPSHOT);
  });

  it("null snapshot (pre-BRIEF-52 row) parses to null", () => {
    const parsed = parseBriefContext({ repoConfig: null });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.value).toBeNull();
  });

  it.each([
    ["not an object", "x"],
    ["missing files", { repoConfig: { collisions: [], policy: null } }],
    [
      "bad outcome",
      {
        repoConfig: {
          files: [{ path: "p", blobSha: null, outcome: "nope" }],
          collisions: [],
          policy: null,
        },
      },
    ],
    [
      "bad fired attr",
      {
        repoConfig: {
          files: [],
          collisions: [],
          policy: { firedCustomAttributes: [{ name: 1 }], deEmphasize: [] },
        },
      },
    ],
    [
      "bad rule",
      {
        repoConfig: {
          files: [],
          collisions: [],
          policy: { firedCustomAttributes: [], deEmphasize: [{ paths: [] }] },
        },
      },
    ],
  ])("rejects %s", (_label, value) => {
    expect(parseBriefContext(value).ok).toBe(false);
  });
});

describe("attributeDisplayMeta", () => {
  it("no snapshot / no policy → plain built-in meta", () => {
    expect(attributeDisplayMeta(null, "no-tests", "a.ts", false)).toEqual({
      source: "built-in",
      deEmphasized: false,
    });
    expect(
      attributeDisplayMeta(
        { ...SNAPSHOT, policy: null },
        "no-tests",
        "a.ts",
        false,
      ),
    ).toEqual({ source: "built-in", deEmphasized: false });
  });

  it("fired custom attribute → repo-policy source with criteria + implication", () => {
    const meta = attributeDisplayMeta(
      SNAPSHOT,
      "touches-billing",
      "services/billing/x.ts",
      false,
    );
    expect(meta.source).toBe("repo-policy");
    expect(meta.criteria).toBe("modifies invoicing code");
    expect(meta.implication).toBe("needs finance review");
    expect(meta.deEmphasized).toBe(false);
  });

  it("unscoped de-emphasis rule quiets everywhere; scoped rule only inside its globs", () => {
    expect(
      attributeDisplayMeta(
        SNAPSHOT,
        "widens-error-handling",
        "any/file.ts",
        false,
      ).deEmphasized,
    ).toBe(true);
    expect(
      attributeDisplayMeta(SNAPSHOT, "no-tests", "generated/api.ts", false)
        .deEmphasized,
    ).toBe(true);
    expect(
      attributeDisplayMeta(SNAPSHOT, "no-tests", "src/api.ts", false)
        .deEmphasized,
    ).toBe(false);
  });

  it("floor attributes can never be de-emphasized", () => {
    const hostile: RepoConfigContext = {
      ...SNAPSHOT,
      policy: {
        firedCustomAttributes: [],
        // Malformed snapshot (writer forbids this) — display still refuses.
        deEmphasize: [{ attribute: "touches-auth" }],
      },
    };
    expect(
      attributeDisplayMeta(hostile, "touches-auth", "a.ts", true).deEmphasized,
    ).toBe(false);
  });

  it("floor co-fire un-quiets a de-emphasized attribute on the SAME chunk only", () => {
    expect(
      attributeDisplayMeta(SNAPSHOT, "widens-error-handling", "a.ts", true)
        .deEmphasized,
    ).toBe(false);
    expect(
      attributeDisplayMeta(SNAPSHOT, "widens-error-handling", "a.ts", false)
        .deEmphasized,
    ).toBe(true);
  });
});

describe("floorFirst", () => {
  it("pins floor attributes first (declared order), keeps the rest by appearance", () => {
    expect(
      floorFirst([
        "no-tests",
        "relaxes-permissions",
        "hot-path",
        "touches-auth",
      ]),
    ).toEqual(["touches-auth", "relaxes-permissions", "no-tests", "hot-path"]);
  });
});

describe("lockstep pins (FE copies vs their sources)", () => {
  it("floor list equals repo-config's FLOOR_ATTRIBUTES", () => {
    expect([...FLOOR_ATTRIBUTES]).toEqual([...SOURCE_FLOOR_ATTRIBUTES]);
  });

  it("every mirrored wire-contract constant equals its repo-config source", () => {
    // A legitimate cap/vocabulary bump upstream must turn a test red HERE —
    // the best-effort context query would otherwise silently drop every
    // source marker for new briefs (Fable round 14).
    expect([...OUTCOMES]).toEqual(Object.values(RepoConfigOutcome));
    expect([...SLOT_PATHS]).toEqual([
      RepoConfigPaths.INSTRUCTIONS,
      RepoConfigPaths.SETTINGS,
      RepoConfigPaths.POLICY,
    ]);
    expect(NAME_PATTERN.source).toBe(ATTRIBUTE_NAME_PATTERN.source);
    expect(NAME_MAX_CHARS).toBe(ATTRIBUTE_NAME_MAX_CHARS);
    expect(CRITERIA_MAX_CHARS).toBe(SOURCE_CRITERIA_MAX_CHARS);
    expect(IMPLICATION_MAX_CHARS).toBe(SOURCE_IMPLICATION_MAX_CHARS);
  });

  it("glob matcher agrees with the categorizer's on a behavior table", () => {
    const cases: Array<[string, string]> = [
      ["src/**", "src/a/b.ts"],
      ["src/**", "other/x.ts"],
      ["**/*.sql", "db/m/0001.sql"],
      ["**/*.sql", "x.sql"],
      ["*.md", "docs/README.md"],
      ["src/**/fixtures/*.json", "src/notfixtures/x.json"],
      ["src/**/fixtures/*.json", "src/a/fixtures/x.json"],
      ["a/**/z", "a/bz"],
      ["a?c/x.ts", "abc/x.ts"],
      ["services/*/handlers/**", "services/auth/handlers/login.ts"],
      ["exact/path.ts", "exact/path.ts"],
      ["a+b/(x)/f.ts", "a+b/(x)/f.ts"],
      ["***z", "bbbbz"],
    ];
    for (const [pattern, file] of cases) {
      expect(matchesGlob(pattern, file), `${pattern} vs ${file}`).toBe(
        sourceMatchesGlob(pattern, file),
      );
    }
  });
});

describe("parseBriefContext — canonical-shape tightening (codex r1)", () => {
  const slots = SNAPSHOT.files;
  it.each([
    ["missing a slot", { ...SNAPSHOT, files: slots.slice(0, 2) }],
    ["reordered slots", { ...SNAPSHOT, files: [slots[1], slots[0], slots[2]] }],
    [
      "foreign path",
      {
        ...SNAPSHOT,
        files: [slots[0], slots[1], { ...slots[2], path: "evil.yaml" }],
      },
    ],
    [
      "off-charset fired name",
      {
        ...SNAPSHOT,
        policy: {
          firedCustomAttributes: [{ name: "Bad Name", criteria: "c" }],
          deEmphasize: [],
        },
      },
    ],
    [
      "over-cap criteria",
      {
        ...SNAPSHOT,
        policy: {
          firedCustomAttributes: [
            { name: "ok-name", criteria: "x".repeat(4001) },
          ],
          deEmphasize: [],
        },
      },
    ],
    [
      "floor attribute in deEmphasize",
      {
        ...SNAPSHOT,
        policy: {
          firedCustomAttributes: [],
          deEmphasize: [{ attribute: "touches-auth" }],
        },
      },
    ],
  ])("rejects a snapshot with %s", (_label, snapshot) => {
    expect(parseBriefContext({ repoConfig: snapshot }).ok).toBe(false);
  });
});
