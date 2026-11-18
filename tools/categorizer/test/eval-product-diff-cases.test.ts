// The Product diff cases' predicates, proved to discriminate without a
// generation run: the cases are unbaselined and each run is real spend. Each
// property is scored against a brief that should pass it and one that should
// fail it, and every fixture must stay a one-call brief, or the section is
// unavailable and every row property fails for a reason the case is not about.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CallPlanKinds, decideCallPlan } from "brief-core";
import {
  BeforeSources,
  ProductChangeAreas,
  ProductDiffAvailabilities,
  type Brief,
  type ChangeGroup,
  type ProductChange,
} from "brief-core/types";
import { ChangeGroupCategories } from "types/reviews";
import { loadCases, type EvalCase } from "../eval/loadCase";
import { scoreRuns } from "../eval/properties";
import { makeBrief } from "./eval-fixtures";

const CASES_DIR = fileURLToPath(new URL("../eval/cases", import.meta.url));

const ProductDiffCaseIds = {
  REMOVED_LINES: "product-diff-removed-lines",
  PR_TEXT_CONTRADICTS: "product-diff-pr-text-contradicts",
  RENAME_ONLY: "product-diff-rename-only",
  NEW_ROUTE: "product-diff-new-route",
  OVER_CAP: "product-diff-over-cap",
} as const;
const CASE_IDS = Object.values(ProductDiffCaseIds);

/** Properties that hold on an absent section by design, each anchored by another. */
const ABSENCE_PASSES = new Set(["no-contradicted-before"]);

const POLL_ROW = {
  when: "a reader keeps the inbox open in a visible tab",
  after: "The list re-reads every 30 seconds and new briefs appear.",
};
const CURSOR_ROW = {
  when: "a re-read adds rows above the keyboard cursor",
  after: "The cursor stays on its row.",
};
/** The cursor change worded around the poll that moves the rows. */
const POLL_CURSOR_ROW = {
  when: "a poll adds or removes rows above the keyboard cursor",
  after: "The cursor stays on its row.",
};
const REGENERATE_ROW = {
  when: "a caller posts to the regenerate route for a failed head",
  after: "The route queues a new run and answers 202.",
};
const REGENERATE_HELD_ROW = {
  when: "a regenerate request targets a head a running generation holds",
  after: "The route answers 409 and queues nothing.",
};

async function loadProductDiffCase(id: string): Promise<EvalCase> {
  const loaded = await loadCases(CASES_DIR, id);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }

  const found = loaded.value[0];
  if (found === undefined) {
    throw new Error(`${id} did not load`);
  }
  return found;
}

async function scoreCase(
  id: string,
  brief: Brief,
): Promise<Record<string, number>> {
  const { properties } = await loadProductDiffCase(id);
  const { scores } = scoreRuns(properties, [brief]);
  const entries = [...scores].map(([propertyId, score]) => [
    propertyId,
    score.passes,
  ]);
  return Object.fromEntries(entries);
}

/** The property ids a single scored brief did not pass. */
function listFailing(scores: Record<string, number>): string[] {
  return Object.keys(scores).filter((propertyId) => scores[propertyId] !== 1);
}

/** The property ids a single scored brief passed. */
function listPassing(scores: Record<string, number>): string[] {
  return Object.keys(scores).filter((propertyId) => scores[propertyId] === 1);
}

function stubChange(fields: Partial<ProductChange>): ProductChange {
  return {
    when: "a reader opens a page",
    after: "The page shows.",
    affects: ProductChangeAreas.USER_FLOW,
    beforeSource: BeforeSources.NOT_SHOWN,
    groupIds: ["g1"],
    ...fields,
  };
}

function stubBriefWithChanges(
  changes: ProductChange[],
  hasMore = false,
): Brief {
  return makeBrief({
    productDiff: {
      availability: ProductDiffAvailabilities.AVAILABLE,
      changes,
      hasMore,
    },
  });
}

function stubOverCapBrief(hasMore: boolean): Brief {
  const headline = [
    stubChange({
      when: "a user runs `groups` with no `--base` or `--head`",
      after: "It serves the latest finished revision.",
    }),
    stubChange({
      when: "a user passes `--revision <n>`",
      after: "It serves that revision.",
    }),
  ];
  const rest = Array.from({ length: 6 }, (_unused, index) =>
    stubChange({ when: `an edge case ${index}` }),
  );
  return stubBriefWithChanges([...headline, ...rest], hasMore);
}

describe("the Product diff cases", () => {
  it.each(CASE_IDS)("keeps %s a one-call brief", async (id) => {
    const { fixture } = await loadProductDiffCase(id);
    const plan = decideCallPlan({ diff: fixture.pr.diff });

    expect(plan.kind).toBe(CallPlanKinds.SINGLE);
  });

  it("shares one diff between the removed-lines case and its twin", async () => {
    const removed = await loadProductDiffCase(ProductDiffCaseIds.REMOVED_LINES);
    const twin = await loadProductDiffCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
    );

    expect(twin.fixture.pr.diff).toBe(removed.fixture.pr.diff);
    expect(twin.fixture.pr.meta.files).toEqual(removed.fixture.pr.meta.files);
    expect(twin.fixture.pr.meta.body).not.toBe(removed.fixture.pr.meta.body);
  });

  it.each(CASE_IDS)("fails %s on a brief with no Product diff", async (id) => {
    const absent = await scoreCase(id, makeBrief());
    const unavailable = await scoreCase(
      id,
      makeBrief({
        productDiff: {
          availability: ProductDiffAvailabilities.UNAVAILABLE,
          changes: [],
          hasMore: false,
        },
      }),
    );
    const passing = [...listPassing(absent), ...listPassing(unavailable)];

    expect(
      passing.filter((propertyId) => !ABSENCE_PASSES.has(propertyId)),
    ).toEqual([]);
  });

  it("fails a row naming a change-group the brief does not have", async () => {
    const brief = stubBriefWithChanges([
      stubChange({ ...REGENERATE_ROW, groupIds: ["g9"] }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.NEW_ROUTE, brief);

    expect(scores["product-change-groups-real"]).toBe(0);
  });
});

describe("the removed-lines case", () => {
  const diffBefore = {
    before: "The list re-read only on a window focus.",
    beforeSource: BeforeSources.DIFF,
  };

  it("passes a poll row read from the diff beside a cursor row", async () => {
    const brief = stubBriefWithChanges([
      stubChange({ ...POLL_ROW, ...diffBefore }),
      stubChange(CURSOR_ROW),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(listFailing(scores)).toEqual([]);
  });

  it("fails the diff-source property on a before taken from the PR text", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        ...diffBefore,
        beforeSource: BeforeSources.PR_TEXT,
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-before-shown"]).toBe(1);
    expect(scores["inbox-poll-before-from-diff"]).toBe(0);
  });

  it("does not read a failed re-read row as the poll row", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        when: "a re-read fails while the list is on screen",
        after: "The rows stay and the poll waits for a window focus.",
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-listed"]).toBe(0);
  });

  it.each([
    ["comes back signed out", "a re-read comes back signed out"],
    ["signs the reader out", "a re-read signs the reader out"],
  ])("does not read a read that %s as the poll row", async (_label, when) => {
    const brief = stubBriefWithChanges([
      stubChange({ when, after: "The poll stops until a window focus." }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-listed"]).toBe(0);
  });

  it("reads a row that names the poll without its cadence as the poll row", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        when: "a reader keeps the inbox open",
        after: "The list now polls while the tab is visible.",
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-listed"]).toBe(1);
  });

  it("does not read a cursor row that names a poll as the poll row", async () => {
    const brief = stubBriefWithChanges([
      stubChange({ ...POLL_CURSOR_ROW, ...diffBefore }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["cursor-follows-row-listed"]).toBe(1);
    expect(scores["inbox-poll-listed"]).toBe(0);
    expect(scores["inbox-poll-before-from-diff"]).toBe(0);
  });

  it("fails the cursor property when only a before names the cursor", async () => {
    const brief = stubBriefWithChanges([
      stubChange({ ...POLL_ROW, ...diffBefore }),
      stubChange({
        when: "a re-read fails while the list is on screen",
        before: "The failure card took the selection and the cursor with it.",
        beforeSource: BeforeSources.PR_TEXT,
        after: "The rows stay on screen.",
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["cursor-follows-row-listed"]).toBe(0);
  });

  it("keeps a poll row that also says the page never scrolls", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        ...diffBefore,
        after: "The list re-reads every 30 seconds and the page never scrolls.",
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-listed"]).toBe(1);
    expect(scores["inbox-poll-before-from-diff"]).toBe(1);
  });

  it("fails the cursor property on a failed read that keeps the cursor", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        when: "a re-read fails while the list is on screen",
        after: "The rows, the selection and the cursor stay.",
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["cursor-follows-row-listed"]).toBe(0);
  });

  it("fails the before property on a poll row that states no before", async () => {
    const brief = stubBriefWithChanges([
      stubChange(POLL_ROW),
      stubChange(CURSOR_ROW),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-listed"]).toBe(1);
    expect(scores["inbox-poll-before-shown"]).toBe(0);
  });

  it("fails the cursor property when no row names the cursor", async () => {
    const brief = stubBriefWithChanges([
      stubChange({ ...POLL_ROW, ...diffBefore }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.REMOVED_LINES, brief);

    expect(scores["inbox-poll-before-from-diff"]).toBe(1);
    expect(scores["cursor-follows-row-listed"]).toBe(0);
  });
});

describe("the contradicting-description case", () => {
  it("passes a poll row whose before comes from the removed lines", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        before: "The list did not poll; a window focus re-read it.",
        beforeSource: BeforeSources.DIFF,
      }),
    ]);
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      brief,
    );

    expect(listFailing(scores)).toEqual([]);
  });

  it("fails the poll properties when only a cursor row names a poll", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_CURSOR_ROW,
        before: "The cursor kept its index and landed on another row.",
        beforeSource: BeforeSources.DIFF,
      }),
    ]);
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      brief,
    );

    expect(scores["inbox-poll-listed"]).toBe(0);
    expect(scores["poll-before-not-pr-text"]).toBe(0);
  });

  it("fails on a before that repeats the description's false figure", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        before: "The list already polled every 10 seconds.",
        beforeSource: BeforeSources.PR_TEXT,
      }),
    ]);
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      brief,
    );

    expect(scores["no-contradicted-before"]).toBe(0);
    expect(scores["poll-before-not-pr-text"]).toBe(0);
  });

  it("passes a true before that says the list already re-read on focus", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        before: "The list already re-read on a window focus but did not poll.",
        beforeSource: BeforeSources.DIFF,
      }),
    ]);
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      brief,
    );

    expect(scores["no-contradicted-before"]).toBe(1);
  });

  it("fails on a before that says the list already polled", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        before: "The list already polled for new briefs.",
        beforeSource: BeforeSources.DIFF,
      }),
    ]);
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      brief,
    );

    expect(scores["no-contradicted-before"]).toBe(0);
  });

  it("fails on a before that keeps the false poll without its figure", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...POLL_ROW,
        before: "The list already re-read itself every few seconds.",
        beforeSource: BeforeSources.DIFF,
      }),
    ]);
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      brief,
    );

    expect(scores["no-contradicted-before"]).toBe(0);
  });

  it("fails when the description empties the section", async () => {
    const scores = await scoreCase(
      ProductDiffCaseIds.PR_TEXT_CONTRADICTS,
      stubBriefWithChanges([]),
    );

    expect(scores["pr-text-did-not-empty"]).toBe(0);
    expect(scores["inbox-poll-listed"]).toBe(0);
  });
});

describe("the rename-only case", () => {
  const refactorGroup: ChangeGroup = {
    id: "g1",
    title: "Rename the accent variant",
    summary: "renames it",
    dominantCategory: ChangeGroupCategories.LOGIC_REFACTOR,
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };

  it("passes an empty read section beside a refactor group", async () => {
    const brief = {
      ...stubBriefWithChanges([]),
      changeGroups: [refactorGroup],
    };
    const scores = await scoreCase(ProductDiffCaseIds.RENAME_ONLY, brief);

    expect(listFailing(scores)).toEqual([]);
  });

  it("fails on a listed change or a claim of more", async () => {
    const listed = await scoreCase(
      ProductDiffCaseIds.RENAME_ONLY,
      stubBriefWithChanges([stubChange({})]),
    );
    const claimsMore = await scoreCase(
      ProductDiffCaseIds.RENAME_ONLY,
      stubBriefWithChanges([], true),
    );

    expect(listed["rename-no-product-changes"]).toBe(0);
    expect(claimsMore["rename-has-more-false"]).toBe(0);
  });

  it("fails the category property beside a group read as a fix", async () => {
    const fixGroup = {
      ...refactorGroup,
      dominantCategory: ChangeGroupCategories.BUGFIX,
    };
    const brief = { ...stubBriefWithChanges([]), changeGroups: [fixGroup] };
    const scores = await scoreCase(ProductDiffCaseIds.RENAME_ONLY, brief);

    expect(scores["rename-no-product-changes"]).toBe(1);
    expect(scores["rename-groups-not-behavioural"]).toBe(0);
  });

  it("fails the category property when the section was not read", async () => {
    const brief = makeBrief({ changeGroups: [refactorGroup] });
    const scores = await scoreCase(ProductDiffCaseIds.RENAME_ONLY, brief);

    expect(scores["rename-groups-not-behavioural"]).toBe(0);
  });
});

describe("the new-route case", () => {
  it("passes regenerate rows sourced as new, before or none", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...REGENERATE_ROW,
        before: "There was no regenerate route.",
        beforeSource: BeforeSources.DID_NOT_EXIST,
      }),
      stubChange({
        ...REGENERATE_HELD_ROW,
        beforeSource: BeforeSources.DID_NOT_EXIST,
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.NEW_ROUTE, brief);

    expect(listFailing(scores)).toEqual([]);
  });

  it("passes one row that folds the route's refusals into it", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...REGENERATE_ROW,
        beforeSource: BeforeSources.DID_NOT_EXIST,
      }),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.NEW_ROUTE, brief);

    expect(listFailing(scores)).toEqual([]);
  });

  it("fails when one of the route's behaviours reads as not shown", async () => {
    const brief = stubBriefWithChanges([
      stubChange({
        ...REGENERATE_ROW,
        before: "There was no regenerate route.",
        beforeSource: BeforeSources.DID_NOT_EXIST,
      }),
      stubChange(REGENERATE_HELD_ROW),
    ]);
    const scores = await scoreCase(ProductDiffCaseIds.NEW_ROUTE, brief);

    expect(scores["regenerate-sourced-did-not-exist"]).toBe(1);
    expect(scores["regenerate-rows-never-not-shown"]).toBe(0);
  });

  it("fails the route property when no row names the route", async () => {
    const brief = stubBriefWithChanges([stubChange({})]);
    const scores = await scoreCase(ProductDiffCaseIds.NEW_ROUTE, brief);

    expect(scores["product-diff-available"]).toBe(1);
    expect(scores["regenerate-route-listed"]).toBe(0);
  });

  it("fails both source properties when the only row is not shown", async () => {
    const brief = stubBriefWithChanges([stubChange(REGENERATE_ROW)]);
    const scores = await scoreCase(ProductDiffCaseIds.NEW_ROUTE, brief);

    expect(scores["regenerate-route-listed"]).toBe(1);
    expect(scores["regenerate-sourced-did-not-exist"]).toBe(0);
    expect(scores["regenerate-rows-never-not-shown"]).toBe(0);
  });
});

describe("the over-cap case", () => {
  it("passes a full section with both headline rows and hasMore", async () => {
    const scores = await scoreCase(
      ProductDiffCaseIds.OVER_CAP,
      stubOverCapBrief(true),
    );

    expect(listFailing(scores)).toEqual([]);
  });

  it("fails the hasMore property when the section claims no more", async () => {
    const scores = await scoreCase(
      ProductDiffCaseIds.OVER_CAP,
      stubOverCapBrief(false),
    );

    expect(scores["has-more-set"]).toBe(0);
    expect(scores["latest-revision-default-listed"]).toBe(1);
  });

  it("fails the default row when only the flag row says latest", async () => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when: "a user passes the `--revision <n>` flag to `session`",
          after: "It reads that revision instead of the latest finished one.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["revision-flag-listed"]).toBe(1);
    expect(scores["latest-revision-default-listed"]).toBe(0);
  });

  it("fails the default row when the only latest row passes span flags", async () => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when: "a user passes `--base`/`--head` to `diff <n>`",
          after: "It reads that span instead of the latest finished revision.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["latest-revision-default-listed"]).toBe(0);
  });

  it("passes a default row that names the missing flag by its absence", async () => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when: "a user runs `groups` with no revision named",
          after: "It reads the newest finished revision.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["latest-revision-default-listed"]).toBe(1);
  });

  it.each([
    [
      "by the three flags it leaves out",
      "a user runs `groups <n>` without `--base`, `--head` or `--revision`",
    ],
    ["as no SHAs", "a user runs `diff <n>` with no SHAs"],
    [
      "as none of the flags",
      "a user passes none of `--base`, `--head` or `--revision`",
    ],
    ["as neither flag", "a read names neither `--head` nor `--revision`"],
    ["as only the PR number", "a user runs `session` with only the PR number"],
  ])("passes a default row worded %s", async (_label, when) => {
    const brief = stubBriefWithChanges(
      [stubChange({ when, after: "It serves the latest finished revision." })],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["latest-revision-default-listed"]).toBe(1);
  });

  it("fails the default row on a flag row that also says default", async () => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when: "a user passes `--revision <n>` instead of taking the default",
          after: "It reads that revision rather than the latest.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["revision-flag-listed"]).toBe(1);
    expect(scores["latest-revision-default-listed"]).toBe(0);
  });

  it.each([
    ["no-flag or", "a no-flag or `--revision` read succeeds"],
    [
      "no span flags or with",
      "a read with no span flags or with `--revision` succeeds",
    ],
    [
      "without span flags or with",
      "a read without span flags or with `--revision` succeeds",
    ],
  ])("counts a two-read row as the flag's: %s", async (_label, when) => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when,
          after: "The CLI records the latest revision read.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["revision-flag-listed"]).toBe(1);
    expect(scores["latest-revision-default-listed"]).toBe(0);
  });

  it("reads a row whose outcome says what the flag does as the flag's", async () => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when: "a user reads an older revision",
          after: "`--revision <n>` names it, and the read says which is newer.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["revision-flag-listed"]).toBe(1);
  });

  it("fails the flag property when the flag is only named as left out", async () => {
    const brief = stubBriefWithChanges(
      [
        stubChange({
          when: "a user runs `groups <n>` without `--head` or `--revision`",
          after: "It serves the latest finished revision.",
        }),
      ],
      true,
    );
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["latest-revision-default-listed"]).toBe(1);
    expect(scores["revision-flag-listed"]).toBe(0);
  });

  it("fails the cap property on a section of nine rows", async () => {
    const nine = Array.from({ length: 9 }, (_unused, index) =>
      stubChange({ when: `an edge case ${index}` }),
    );
    const scores = await scoreCase(
      ProductDiffCaseIds.OVER_CAP,
      stubBriefWithChanges(nine, true),
    );

    expect(scores["has-more-set"]).toBe(1);
    expect(scores["at-most-eight"]).toBe(0);
  });

  it("fails the headline properties when neither row is listed", async () => {
    const brief = stubBriefWithChanges([stubChange({})], true);
    const scores = await scoreCase(ProductDiffCaseIds.OVER_CAP, brief);

    expect(scores["latest-revision-default-listed"]).toBe(0);
    expect(scores["revision-flag-listed"]).toBe(0);
  });
});
