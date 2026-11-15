// Repo-config display-weight resolution and the lockstep pins. The mirrored
// floor list must never drift from its source, which is imported here at dev
// time only.
import { describe, expect, it } from "vitest";
import {
  FLOOR_ATTRIBUTES as SOURCE_FLOOR_ATTRIBUTES,
  RepoConfigOutcomes,
  RepoConfigPaths,
} from "repo-config/constants";
import { appI18n } from "../../../../i18n/I18nProvider";
import {
  attributeDisplayMeta,
  FLOOR_ATTRIBUTES,
  floorFirst,
  getRepoConfigOutcomeLabel,
  SLOT_PATHS,
  type RepoConfigContext,
} from "./repo-config";
import { repoConfigContextFixture as SNAPSHOT } from "../../test-utils/fixtures";

describe("getRepoConfigOutcomeLabel", () => {
  it("reads applied as applied and every other outcome as not applied", () => {
    expect(
      getRepoConfigOutcomeLabel(appI18n.t, RepoConfigOutcomes.APPLIED),
    ).toBe("Applied");
    for (const outcome of [
      RepoConfigOutcomes.ABSENT,
      RepoConfigOutcomes.INVALID,
      RepoConfigOutcomes.OVER_BUDGET,
    ]) {
      expect(getRepoConfigOutcomeLabel(appI18n.t, outcome)).toBe("Not applied");
    }
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
    expect([...SLOT_PATHS]).toEqual([
      RepoConfigPaths.INSTRUCTIONS,
      RepoConfigPaths.SETTINGS,
      RepoConfigPaths.POLICY,
    ]);
  });
});
