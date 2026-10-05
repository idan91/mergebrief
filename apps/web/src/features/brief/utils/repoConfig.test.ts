// Repo-config snapshot support: wire parsing, display-weight resolution, and
// the lockstep pins. The mirrored floor list must never drift from its source,
// which is imported here at dev time only. The path matcher is no longer
// mirrored; the screen calls its owner.
import { describe, expect, it } from "vitest";
import { matchesGlob } from "brief-core/path-matching";
import {
  ATTRIBUTE_NAME_MAX_CHARS,
  ATTRIBUTE_NAME_PATTERN,
  CRITERIA_MAX_CHARS as SOURCE_CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES as SOURCE_FLOOR_ATTRIBUTES,
  IMPLICATION_MAX_CHARS as SOURCE_IMPLICATION_MAX_CHARS,
  RepoConfigOutcomes,
  RepoConfigPaths,
} from "repo-config";
import {
  attributeDisplayMeta,
  CRITERIA_MAX_CHARS,
  FLOOR_ATTRIBUTES,
  floorFirst,
  IMPLICATION_MAX_CHARS,
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

  it("null snapshot parses to null", () => {
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

  it("marks a fired custom attribute as repo-policy with its text", () => {
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

  it("quiets everywhere unscoped, and only inside the globs when scoped", () => {
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
        // Malformed snapshot, which the writer forbids; display still refuses.
        deEmphasize: [{ attribute: "touches-auth" }],
      },
    };
    expect(
      attributeDisplayMeta(hostile, "touches-auth", "a.ts", true).deEmphasized,
    ).toBe(false);
  });

  it("un-quiets a de-emphasized attribute on its own chunk only", () => {
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
  it("pins floor attributes in declared order, then the rest by appearance", () => {
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

describe("lockstep pins on the values this screen copies", () => {
  it("floor list equals repo-config's FLOOR_ATTRIBUTES", () => {
    expect([...FLOOR_ATTRIBUTES]).toEqual([...SOURCE_FLOOR_ATTRIBUTES]);
  });

  it("every mirrored wire-contract constant equals its repo-config source", () => {
    // A legitimate cap or vocabulary bump upstream must turn a test red HERE:
    // the best-effort context query would otherwise silently drop every
    // source marker for new briefs.
    expect([...OUTCOMES]).toEqual(Object.values(RepoConfigOutcomes));
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

  // The matcher now has one owner, so a lockstep comparison would compare a
  // function with itself. These are the same cases with literal results: what
  // this screen shows when a repo policy scopes an attribute by path.
  it.each([
    ["src/**", "src/a/b.ts", true],
    ["src/**", "other/x.ts", false],
    ["**/*.sql", "db/m/0001.sql", true],
    ["**/*.sql", "x.sql", true],
    ["*.md", "docs/README.md", false],
    ["src/**/fixtures/*.json", "src/notfixtures/x.json", false],
    ["src/**/fixtures/*.json", "src/a/fixtures/x.json", true],
    ["a/**/z", "a/bz", false],
    ["a?c/x.ts", "abc/x.ts", true],
    ["services/*/handlers/**", "services/auth/handlers/login.ts", true],
    ["exact/path.ts", "exact/path.ts", true],
    ["a+b/(x)/f.ts", "a+b/(x)/f.ts", true],
    ["***z", "bbbbz", true],
  ])("matches %s against %s", (pattern, file, expected) => {
    expect(matchesGlob(pattern, file)).toBe(expected);
  });
});

describe("parseBriefContext canonical-shape tightening", () => {
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
