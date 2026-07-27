// Lockstep drift pins for the brief vocabulary mirror (BRIEF-44 PR 7).
//
// `types.ts` is a hand-rolled mirror of brief-core's closed vocabularies, so
// NOTHING structurally couples the two — and CI is path-filtered per package,
// meaning a brief-core vocabulary change does not run this suite in CI
// (BRIEF-23 shipped a parser break under a green CI). These pins import the
// SOURCE package directly at dev time (the app bundle never imports it) so
// whichever side moves, the OTHER side's suite goes red locally.
import { describe, expect, it } from "vitest";
import {
  Categories as SOURCE_CATEGORIES,
  Concerns as SOURCE_CONCERNS,
  Roles as SOURCE_ROLES,
  RiskSurfaceAttributes as SOURCE_RISK_SURFACE_ATTRIBUTES,
  Specificities as SOURCE_SPECIFICITIES,
  RevisionNarrativeSkipReasons as SOURCE_SKIP_REASONS,
  type Specificity as SourceSpecificity,
  type RevisionNarrativeSkipReason as SourceSkipReason,
} from "brief-core";
import type { Equals } from "types";
import {
  Categories,
  Concerns,
  Roles,
  RiskSurfaceAttributes,
  type RevisionNarrativeSkipReason,
  type Specificity,
} from "./types";

interface VocabularyPin {
  readonly label: string;
  /** The FE's as-const map: SHOUT_CASE key → kebab-case wire value. */
  readonly mirror: Readonly<Record<string, string>>;
  /** brief-core's as-const array of the same wire values. */
  readonly source: readonly string[];
}

const VOCABULARY_PINS: readonly VocabularyPin[] = [
  { label: "Categories", mirror: Categories, source: SOURCE_CATEGORIES },
  { label: "Concerns", mirror: Concerns, source: SOURCE_CONCERNS },
  { label: "Roles", mirror: Roles, source: SOURCE_ROLES },
  {
    label: "RiskSurfaceAttributes",
    mirror: RiskSurfaceAttributes,
    source: SOURCE_RISK_SURFACE_ATTRIBUTES,
  },
];

describe("lockstep pins (brief vocabulary mirror vs brief-core)", () => {
  it.each(VOCABULARY_PINS)(
    "$label mirrors brief-core's wire values exactly",
    ({ mirror, source }) => {
      // Sorted comparison is MULTISET equality: it catches an added, removed,
      // renamed, or duplicated token. Only the order is forgiven — the FE
      // map's declaration order is local, so an upstream reorder is not drift.
      expect(Object.values(mirror).toSorted()).toEqual(source.toSorted());
    },
  );

  it.each(VOCABULARY_PINS)(
    "$label derives every key from its wire value",
    ({ mirror }) => {
      // Closes the swap hole multiset equality leaves open: two keys trading
      // values keeps the value set identical while every call site that reads
      // `Categories.PURE_MOVE` starts returning the wrong token.
      //
      // Strict SHOUT_CASE→kebab-case derivation, so this doubles as the
      // convention gate for these maps (root CLAUDE.md: keys SHOUT_CASE,
      // values kebab-case) — `LOGICREFACTOR: "logic-refactor"` fails here.
      for (const [key, value] of Object.entries(mirror)) {
        expect(key.toLowerCase().replaceAll("_", "-")).toBe(value);
      }
    },
  );

  it("mirrors brief-core's intent-check and skip-reason unions exactly", () => {
    // These two mirrors are plain unions on the FE side (deliberately — the
    // `ComparisonBaselineLabel` precedent), so the pin is type-level, gated by
    // `pnpm -C apps/web typecheck`, which includes test files. `Equals` is
    // exact: a token added, removed, or renamed on either side fails to
    // compile. Unknown `specificity` makes validation DROP the whole
    // intentCheck, so drift here silently deletes the intent bar.
    const specificityPin: Equals<Specificity, SourceSpecificity> = true;
    const skipReasonPin: Equals<RevisionNarrativeSkipReason, SourceSkipReason> =
      true;
    expect(specificityPin && skipReasonPin).toBe(true);
    // Runtime half: the wire values themselves, against literals from the
    // spec — so a token renamed on BOTH sides in lockstep (type pins happy,
    // stored artifacts broken) still fails here.
    expect(Object.values(SOURCE_SPECIFICITIES).toSorted()).toEqual([
      "broad",
      "none",
      "precise",
    ]);
    expect(Object.values(SOURCE_SKIP_REASONS).toSorted()).toEqual([
      "disabled by config",
      "span too large",
    ]);
  });
});
