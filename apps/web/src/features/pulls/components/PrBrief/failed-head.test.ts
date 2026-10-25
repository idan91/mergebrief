import { describe, expect, it } from "vitest";
import {
  GenerationFailureClasses,
  GenerationFailureCodes,
  PrStates,
} from "types";
import { readFailureClass } from "@web/utils/failure-class";
import { UnknownValues } from "@web/utils/open-enum/types";

import { appI18n } from "../../../../i18n/I18nProvider";
import {
  buildFailedNote,
  buildFailureLine,
  FixFirstNoteKeys,
  readOffersRegenerate,
} from "./failed-head";

describe("buildFailureLine", () => {
  it("renders real catalog copy for every code, never its key", () => {
    for (const code of Object.values(GenerationFailureCodes)) {
      const rendered = buildFailureLine(appI18n.t, code, "x");
      expect(rendered).not.toBe(`generationError.${code}`);
      expect(rendered.length).toBeGreaterThan(0);
    }
  });

  it("interpolates the detail for the two detail-carrying codes only", () => {
    const withDetail = Object.values(GenerationFailureCodes).filter((code) =>
      buildFailureLine(appI18n.t, code, "SENTINEL").includes("SENTINEL"),
    );
    expect(withDetail.toSorted()).toEqual([
      GenerationFailureCodes.GENERATION_CONFIG,
      GenerationFailureCodes.UNKNOWN,
    ]);
  });

  it("never renders a template with an empty detail hole", () => {
    for (const code of Object.values(GenerationFailureCodes)) {
      for (const detail of [undefined, ""]) {
        const rendered = buildFailureLine(appI18n.t, code, detail);
        expect(rendered.trimEnd()).toBe(rendered);
        expect(rendered).not.toMatch(/[:—]\s*$/);
      }
    }
  });

  it("keeps a detail that arrived with a code this bundle predates", () => {
    expect(
      buildFailureLine(appI18n.t, undefined, "spend cap reached"),
    ).toContain("spend cap reached");
    expect(buildFailureLine(appI18n.t, undefined, undefined)).toBe(
      appI18n.t("pulls.failed.noDetail"),
    );
  });
});

describe("FixFirstNoteKeys", () => {
  it("covers exactly the fix-first codes", () => {
    const fixFirst = Object.values(GenerationFailureCodes).filter(
      (code) => readFailureClass(code) === GenerationFailureClasses.FIX_FIRST,
    );
    expect(Object.keys(FixFirstNoteKeys).toSorted()).toEqual(
      fixFirst.toSorted(),
    );
  });
});

describe("buildFailedNote", () => {
  it("leads a fix-first note with what to fix", () => {
    const note = buildFailedNote(appI18n.t, {
      errorCode: GenerationFailureCodes.GITHUB_ACCESS,
      attempts: 0,
      offersRegenerate: true,
      prState: PrStates.OPEN,
      appInstalled: true,
      awaitsReadyForReview: false,
    });
    expect(note).toBe(
      "The MergeBrief App needs read access to this repository's contents before a rerun can succeed. 1 attempt so far.",
    );
  });

  it("is empty for spent attempts when Regenerate is offered", () => {
    expect(
      buildFailedNote(appI18n.t, {
        errorCode: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
        attempts: 2,
        offersRegenerate: true,
        prState: PrStates.OPEN,
        appInstalled: true,
        awaitsReadyForReview: false,
      }),
    ).toBe(undefined);
  });

  it("says a push re-queues on an open PR nobody can rerun from here", () => {
    const note = buildFailedNote(appI18n.t, {
      errorCode: GenerationFailureCodes.DIFF_TOO_LARGE,
      attempts: 0,
      offersRegenerate: false,
      prState: PrStates.OPEN,
      appInstalled: true,
      awaitsReadyForReview: false,
    });
    expect(note).toBe(
      "1 attempt so far. A new push re-queues generation automatically.",
    );
  });

  it.each([PrStates.CLOSED, PrStates.MERGED])(
    "says a %s PR will not generate, never that a push re-queues",
    (prState) => {
      const note = buildFailedNote(appI18n.t, {
        errorCode: GenerationFailureCodes.PROVIDER_TIMEOUT,
        attempts: 0,
        offersRegenerate: false,
        prState,
        appInstalled: true,
        awaitsReadyForReview: false,
      });
      expect(note).toBe(
        "1 attempt so far. This pull request is no longer open, so no brief will generate.",
      );
    },
  );
});

describe("buildFailedNote on a draft its instance skips", () => {
  it.each([
    GenerationFailureCodes.PROVIDER_TIMEOUT,
    GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
  ])("points a %s draft at ready for review", (errorCode) => {
    const note = buildFailedNote(appI18n.t, {
      errorCode,
      attempts: 0,
      offersRegenerate: false,
      prState: PrStates.OPEN,
      appInstalled: true,
      awaitsReadyForReview: true,
    });
    expect(note).toMatch(/marking this pull request ready for review/);
    expect(note).not.toMatch(/push|review request/);
  });

  it("keeps the ready for review note for a transient failure", () => {
    const note = buildFailedNote(appI18n.t, {
      errorCode: GenerationFailureCodes.PROVIDER_TIMEOUT,
      attempts: 0,
      offersRegenerate: false,
      prState: PrStates.OPEN,
      appInstalled: true,
      awaitsReadyForReview: true,
    });
    expect(note).toBe(
      "1 attempt so far. Brief generation for draft pull requests is off on this instance, so marking this pull request ready for review queues a new run.",
    );
  });

  it.each([
    GenerationFailureCodes.DIFF_TOO_LARGE,
    GenerationFailureCodes.OUTPUT_SECRET,
    GenerationFailureCodes.PROVIDER_REFUSAL,
  ])(
    "waits for a new push before pointing a %s draft at ready",
    (errorCode) => {
      const note = buildFailedNote(appI18n.t, {
        errorCode,
        attempts: 0,
        offersRegenerate: false,
        prState: PrStates.OPEN,
        appInstalled: true,
        awaitsReadyForReview: true,
      });
      expect(note).toBe(
        "1 attempt so far. A rerun of this push fails the same way. Brief generation for draft pull requests is off on this instance, so after a new push, mark this pull request ready for review to brief it.",
      );
    },
  );

  it("still says a merged draft will not generate", () => {
    const note = buildFailedNote(appI18n.t, {
      errorCode: GenerationFailureCodes.PROVIDER_TIMEOUT,
      attempts: 0,
      offersRegenerate: false,
      prState: PrStates.MERGED,
      appInstalled: true,
      awaitsReadyForReview: true,
    });
    expect(note).toBe(
      "1 attempt so far. This pull request is no longer open, so no brief will generate.",
    );
  });
});

describe("buildFailedNote on a url row", () => {
  it.each([PrStates.OPEN, PrStates.CLOSED, PrStates.MERGED])(
    "points a %s url row at a paste, never a push",
    (prState) => {
      const note = buildFailedNote(appI18n.t, {
        errorCode: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
        attempts: 0,
        offersRegenerate: false,
        prState,
        appInstalled: false,
        awaitsReadyForReview: false,
      });
      expect(note).toBe(
        "Paste this pull request's URL on the home page to retry it.",
      );
    },
  );
});

describe("buildFailedNote on a url row a rerun cannot help", () => {
  it("waits for a new push before pointing at a paste", () => {
    const note = buildFailedNote(appI18n.t, {
      errorCode: GenerationFailureCodes.DIFF_TOO_LARGE,
      attempts: 0,
      offersRegenerate: false,
      prState: PrStates.OPEN,
      appInstalled: false,
      awaitsReadyForReview: false,
    });

    expect(note).toBe(
      "1 attempt so far. A rerun of this push fails the same way. After a new push, paste this pull request's URL on the home page to brief it.",
    );
  });
});

describe("readOffersRegenerate", () => {
  const TRANSIENT_PUSHER = {
    errorCode: GenerationFailureCodes.PROVIDER_TIMEOUT,
    viewerCanPush: true,
    appInstalled: true,
    prState: PrStates.OPEN,
  };

  it("offers a pusher on an installed repo a rerun that can help", () => {
    expect(readOffersRegenerate(TRANSIENT_PUSHER)).toBe(true);
  });

  it("withholds it from a pusher whose repo has no App installation", () => {
    expect(
      readOffersRegenerate({ ...TRANSIENT_PUSHER, appInstalled: false }),
    ).toBe(false);
  });

  it.each([PrStates.CLOSED, PrStates.MERGED, UnknownValues.UNKNOWN])(
    "withholds it on a %s pull request",
    (prState) => {
      expect(readOffersRegenerate({ ...TRANSIENT_PUSHER, prState })).toBe(
        false,
      );
    },
  );

  it("withholds it from a viewer without push access", () => {
    expect(
      readOffersRegenerate({ ...TRANSIENT_PUSHER, viewerCanPush: false }),
    ).toBe(false);
  });

  it("withholds it on a cannot-help failure", () => {
    expect(
      readOffersRegenerate({
        ...TRANSIENT_PUSHER,
        errorCode: GenerationFailureCodes.OUTPUT_SECRET,
      }),
    ).toBe(false);
  });
});
