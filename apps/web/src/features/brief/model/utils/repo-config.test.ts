// Repo-config display-weight resolution and the lockstep pins. The mirrored
// floor list must never drift from its source, which is imported here at dev
// time only. The path matcher is no longer mirrored; the screen calls its owner.
import { describe, expect, it } from "vitest";
import { matchesGlob } from "brief-core/path-matching";
import {
  FLOOR_ATTRIBUTES as SOURCE_FLOOR_ATTRIBUTES,
  RepoConfigPaths,
} from "repo-config";
import {
  attributeDisplayMeta,
  FLOOR_ATTRIBUTES,
  floorFirst,
  SLOT_PATHS,
  type RepoConfigContext,
} from "./repo-config";
import { repoConfigContextFixture as SNAPSHOT } from "../../test-utils/fixtures";

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
    expect([...SLOT_PATHS]).toEqual([
      RepoConfigPaths.INSTRUCTIONS,
      RepoConfigPaths.SETTINGS,
      RepoConfigPaths.POLICY,
    ]);
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
