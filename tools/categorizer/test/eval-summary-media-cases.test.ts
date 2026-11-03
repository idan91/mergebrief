// The four Summary Media cases' predicates, validated WITHOUT a generation
// run: the cases are paid and judged by a model, so each property must be
// proved to discriminate before anyone pays for a run. Each is scored
// against a brief that should pass it and one that should fail it.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SummaryMediaPositions,
  type Brief,
  type SummaryMedia,
} from "brief-core/types";
import { loadCases, type EvalCase } from "../eval/loadCase";
import { scoreRuns } from "../eval/properties";
import { readItemKey } from "../eval/private-cases/summary-media-items";
import { makeBrief } from "./eval-fixtures";

const CASES_DIR = fileURLToPath(
  new URL("../eval/private-cases", import.meta.url),
);
const AFTER_LEDE = SummaryMediaPositions.AFTER_LEDE;
const POINTER_LABEL = "Before and after";

async function loadCase(caseId: string): Promise<EvalCase> {
  const loaded = await loadCases(CASES_DIR, caseId);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const found = loaded.value[0];
  if (found === undefined) {
    throw new Error(`${caseId} did not load`);
  }
  return found;
}

/** A brief on the case's own repository and description, with `summaryMedia` as given. */
function makeCaseBrief(
  found: EvalCase,
  summaryMedia?: SummaryMedia,
  description = found.fixture.pr.meta.body,
): Brief {
  const { owner, repo } = found.fixture.pr.locator;
  const base = makeBrief();
  const brief = makeBrief({
    pr: { ...base.pr, repo: `${owner}/${repo}`, description },
  });
  if (summaryMedia !== undefined) {
    brief.summaryMedia = summaryMedia;
  }
  return brief;
}

function makeShown(brief: Brief, ...itemNumbers: number[]): SummaryMedia {
  const shown = itemNumbers.map((itemNumber) => ({
    key: readItemKey(brief, itemNumber),
    position: AFTER_LEDE,
  }));
  return { shown };
}

function makePointer(brief: Brief, ...itemNumbers: number[]): SummaryMedia {
  const items = itemNumbers.map((itemNumber) => readItemKey(brief, itemNumber));
  return { shown: [], pointer: { label: POINTER_LABEL, items } };
}

function readPasses(found: EvalCase, brief: Brief, id: string): number {
  const scored = scoreRuns(found.properties, [brief]);
  return scored.scores.get(id)?.passes ?? -1;
}

describe("the supabase decorative GIF case", () => {
  it("passes when nothing is shown or pointed at", async () => {
    const found = await loadCase("summary-media-supabase-19466");

    const brief = makeCaseBrief(found);

    expect(readPasses(found, brief, "nothing-for-decorative-gif")).toBe(1);
  });

  it("fails when the GIF is shown", async () => {
    const found = await loadCase("summary-media-supabase-19466");
    const plain = makeCaseBrief(found);

    const brief = makeCaseBrief(found, makeShown(plain, 1));

    expect(readPasses(found, brief, "nothing-for-decorative-gif")).toBe(0);
  });

  it("fails when the description yields no Media item", async () => {
    const found = await loadCase("summary-media-supabase-19466");

    const brief = makeCaseBrief(found, undefined, "No media here.");

    expect(readPasses(found, brief, "nothing-for-decorative-gif")).toBe(0);
  });
});

describe("the grafana sequence diagram case", () => {
  it("passes when the diagram is shown and fails when it is not", async () => {
    const found = await loadCase("summary-media-grafana-107803");
    const plain = makeCaseBrief(found);

    const shown = makeCaseBrief(found, makeShown(plain, 1));

    expect(readPasses(found, shown, "shows-sequence-diagram")).toBe(1);
    expect(readPasses(found, plain, "shows-sequence-diagram")).toBe(0);
  });
});

describe("the home-assistant before and after case", () => {
  it("passes a pointer holding both halves, nothing shown", async () => {
    const found = await loadCase("summary-media-home-assistant-55394");
    const plain = makeCaseBrief(found);

    const brief = makeCaseBrief(found, makePointer(plain, 1, 2));

    expect(readPasses(found, brief, "points-at-before-after-pair")).toBe(1);
    expect(readPasses(found, brief, "shows-no-comparison-half")).toBe(1);
  });

  it("fails a shown half and a pointer missing one", async () => {
    const found = await loadCase("summary-media-home-assistant-55394");
    const plain = makeCaseBrief(found);

    const shownHalf = makeCaseBrief(found, makeShown(plain, 1));
    const oneHalf = makeCaseBrief(found, makePointer(plain, 2));

    expect(readPasses(found, shownHalf, "shows-no-comparison-half")).toBe(0);
    expect(readPasses(found, oneHalf, "points-at-before-after-pair")).toBe(0);
  });
});

describe("the code-review 1141 case", () => {
  it("passes a shown item or a pointer and fails neither", async () => {
    const found = await loadCase("summary-media-code-review-1141");
    const plain = makeCaseBrief(found);

    const shown = makeCaseBrief(found, makeShown(plain, 1));
    const pointer = makeCaseBrief(found, makePointer(plain, 2, 3));

    expect(readPasses(found, shown, "offers-summary-media")).toBe(1);
    expect(readPasses(found, pointer, "offers-summary-media")).toBe(1);
    expect(readPasses(found, plain, "offers-summary-media")).toBe(0);
  });
});

describe("the Summary Media guards", () => {
  it("fail a key the description does not hold", async () => {
    const found = await loadCase("summary-media-grafana-107803");
    const plain = makeCaseBrief(found);
    const otherDescription = "![x](https://example.com/other.png)";

    const brief = makeCaseBrief(found, makeShown(plain, 1), otherDescription);

    expect(readPasses(found, brief, "summary-media-keys-name-items")).toBe(0);
  });

  it("fail an item both shown and in the pointer", async () => {
    const found = await loadCase("summary-media-home-assistant-55394");
    const plain = makeCaseBrief(found);
    const key = readItemKey(plain, 1);
    const media: SummaryMedia = {
      shown: [{ key, position: AFTER_LEDE }],
      pointer: { label: POINTER_LABEL, items: [key] },
    };

    const brief = makeCaseBrief(found, media);

    expect(readPasses(found, brief, "summary-media-item-placed-once")).toBe(0);
  });
});
