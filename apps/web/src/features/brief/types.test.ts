// Lockstep drift pins for the brief vocabulary mirror.
//
// `types.ts` is a hand-rolled mirror of brief-core's closed vocabularies, and
// CI is path-filtered per package, so nothing catches drift. These pins import
// the SOURCE package directly at dev time (the app bundle never imports it) so
// whichever side moves, the OTHER side's suite goes red locally.
import { describe, expect, it } from "vitest";
import {
  AlignmentReads as BriefCoreAlignmentReads,
  Categories as BriefCoreCategories,
  PrimaryTicketStatuses as BriefCorePrimaryTicketStatuses,
  ReferenceLocations as BriefCoreReferenceLocations,
  TicketTrackers as BriefCoreTicketTrackers,
  TicketUnreadReasons as BriefCoreTicketUnreadReasons,
  Concerns as BriefCoreConcerns,
  Roles as BriefCoreRoles,
  RiskSurfaceAttributes as BriefCoreRiskSurfaceAttributes,
  Specificities as BriefCoreSpecificities,
  RevisionNarrativeSkipReasons as BriefCoreRevisionNarrativeSkipReasons,
  type Specificity as BriefCoreSpecificity,
  type RevisionNarrativeSkipReason as BriefCoreRevisionNarrativeSkipReason,
} from "brief-core";
import type { Equals } from "types";
import {
  AlignmentReads,
  Categories,
  PrimaryTicketStatuses,
  ReferenceLocations,
  TicketTrackers,
  TicketUnreadReasons,
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
  { label: "Categories", mirror: Categories, source: BriefCoreCategories },
  { label: "Concerns", mirror: Concerns, source: BriefCoreConcerns },
  { label: "Roles", mirror: Roles, source: BriefCoreRoles },
  {
    label: "RiskSurfaceAttributes",
    mirror: RiskSurfaceAttributes,
    source: BriefCoreRiskSurfaceAttributes,
  },
  {
    label: "TicketTrackers",
    mirror: TicketTrackers,
    source: Object.values(BriefCoreTicketTrackers),
  },
  {
    label: "ReferenceLocations",
    mirror: ReferenceLocations,
    source: Object.values(BriefCoreReferenceLocations),
  },
  {
    label: "PrimaryTicketStatuses",
    mirror: PrimaryTicketStatuses,
    source: Object.values(BriefCorePrimaryTicketStatuses),
  },
  {
    label: "TicketUnreadReasons",
    mirror: TicketUnreadReasons,
    source: Object.values(BriefCoreTicketUnreadReasons),
  },
  {
    label: "AlignmentReads",
    mirror: AlignmentReads,
    source: Object.values(BriefCoreAlignmentReads),
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
      // values keeps the value set identical while call sites read the wrong
      // token. Strict SHOUT_CASE→kebab-case derivation, so this doubles as the
      // key/value casing gate.
      for (const [key, value] of Object.entries(mirror)) {
        expect(key.toLowerCase().replaceAll("_", "-")).toBe(value);
      }
    },
  );

  it("mirrors brief-core's intent-check and skip-reason unions exactly", () => {
    // These two mirrors are plain unions on the FE side, so the pin is
    // type-level, gated by typecheck. Unknown `specificity` makes validation
    // DROP the whole intentCheck, so drift here silently deletes the intent bar.
    const specificityPin: Equals<Specificity, BriefCoreSpecificity> = true;
    const skipReasonPin: Equals<
      RevisionNarrativeSkipReason,
      BriefCoreRevisionNarrativeSkipReason
    > = true;
    expect(specificityPin && skipReasonPin).toBe(true);
    // Runtime half: the wire values themselves, against literals from the
    // spec — so a token renamed on BOTH sides in lockstep (type pins happy,
    // stored artifacts broken) still fails here.
    expect(Object.values(BriefCoreSpecificities).toSorted()).toEqual([
      "broad",
      "none",
      "precise",
    ]);
    expect(
      Object.values(BriefCoreRevisionNarrativeSkipReasons).toSorted(),
    ).toEqual(["disabled by config", "span too large"]);
  });
});
