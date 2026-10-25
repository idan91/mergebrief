import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../../../i18n/I18nProvider";
import { makeGeneration, makeMeta } from "./test-utils";
import { LatestPushStates } from "./types";
import {
  buildCappedPushDetail,
  buildFailedPushDetail,
  readLatestPushState,
} from "./utils";

describe("readLatestPushState", () => {
  it("reads a failed latest push with no brief as failed", () => {
    const meta = makeMeta();
    expect(readLatestPushState(meta)).toBe(LatestPushStates.FAILED);
  });

  it.each(["pending", "running"] as const)(
    "reads a %s latest push as generating",
    (status) => {
      const meta = makeMeta({ generation: makeGeneration({ status }) });
      expect(readLatestPushState(meta)).toBe(LatestPushStates.GENERATING);
    },
  );

  it("offers a rerun on a null-base row whose head brief the route ignores", () => {
    const nullBase = { briefAvailable: false, headBriefStored: true };

    const failed = makeMeta(nullBase);
    const running = makeMeta({
      ...nullBase,
      generation: makeGeneration({ status: "running" }),
    });

    expect(readLatestPushState(failed)).toBe(LatestPushStates.FAILED);
    expect(readLatestPushState(running)).toBeUndefined();
  });

  it("is absent once the latest push has its brief", () => {
    const meta = makeMeta({ briefAvailable: true });
    expect(readLatestPushState(meta)).toBe(undefined);
  });

  it("reads a capped latest push with no brief as capped", () => {
    const meta = makeMeta({ generation: makeGeneration({ status: "capped" }) });
    expect(readLatestPushState(meta)).toBe(LatestPushStates.CAPPED);
  });

  it("is absent for a superseded latest push, which a newer head replaces", () => {
    const generation = makeGeneration({ status: "superseded" });
    const meta = makeMeta({ generation });
    expect(readLatestPushState(meta)).toBe(undefined);
  });
});

describe("buildCappedPushDetail", () => {
  const CAPPED_AT = "2026-10-24T10:00:00.000Z";
  const BEFORE_RESET = new Date("2026-10-24T12:00:00.000Z");
  const OPEN_INSTALLED = {
    cappedAt: CAPPED_AT,
    prState: "open",
    appInstalled: true,
    awaitsReadyForReview: false,
  } as const;

  it("names the reset and the push that runs after it", () => {
    const detail = buildCappedPushDetail(
      appI18n.t,
      OPEN_INSTALLED,
      BEFORE_RESET,
    );
    expect(detail).toMatch(
      /^Generation resumes .+\. The next push after the reset is briefed as usual\.$/,
    );
  });

  it("says generation resumed once the reset has passed", () => {
    const after = new Date("2026-10-25T00:00:00.000Z");
    expect(buildCappedPushDetail(appI18n.t, OPEN_INSTALLED, after)).toBe(
      "Generation has since resumed. The next push after the reset is briefed as usual.",
    );
  });

  it("names the daily reset when the skip time is unreadable", () => {
    const input = { ...OPEN_INSTALLED, cappedAt: "not a date" };
    expect(buildCappedPushDetail(appI18n.t, input)).toBe(
      "Generation resumes at the daily reset. The next push after the reset is briefed as usual.",
    );
  });

  it.each(["open", "merged"] as const)(
    "points a %s url row at a paste, not a push",
    (prState) => {
      const input = { ...OPEN_INSTALLED, prState, appInstalled: false };
      const detail = buildCappedPushDetail(appI18n.t, input, BEFORE_RESET);
      expect(detail).toMatch(/Paste this pull request's URL/);
      expect(detail).not.toMatch(/next push/);
    },
  );

  it("points a draft its instance skips at ready for review", () => {
    const input = { ...OPEN_INSTALLED, awaitsReadyForReview: true };
    const detail = buildCappedPushDetail(appI18n.t, input, BEFORE_RESET);
    expect(detail).toMatch(/marking this pull request ready for review/);
    expect(detail).not.toMatch(/next push/);
  });

  it.each(["closed", "merged"] as const)(
    "promises no brief on a %s installation PR",
    (prState) => {
      const input = { ...OPEN_INSTALLED, prState };
      expect(buildCappedPushDetail(appI18n.t, input, BEFORE_RESET)).toBe(
        "This pull request is no longer open, so no brief will generate.",
      );
    },
  );
});

describe("buildFailedPushDetail", () => {
  it("joins the reason and the note the failed card shows", () => {
    const detail = buildFailedPushDetail(appI18n.t, {
      generation: makeGeneration({ attempts: 1 }),
      offersRegenerate: true,
      prState: "open",
      appInstalled: true,
      awaitsReadyForReview: false,
    });

    expect(detail).toBe(
      "The model provider timed out before finishing. 2 attempts so far.",
    );
  });

  it("points a url row at a paste instead of a push", () => {
    const detail = buildFailedPushDetail(appI18n.t, {
      generation: makeGeneration(),
      offersRegenerate: false,
      prState: "open",
      appInstalled: false,
      awaitsReadyForReview: false,
    });

    expect(detail).toBe(
      "The model provider timed out before finishing. 1 attempt so far. Paste this pull request's URL on the home page to retry it.",
    );
  });

  it("points a draft its instance skips at ready for review", () => {
    const detail = buildFailedPushDetail(appI18n.t, {
      generation: makeGeneration(),
      offersRegenerate: false,
      prState: "open",
      appInstalled: true,
      awaitsReadyForReview: true,
    });

    expect(detail).toBe(
      "The model provider timed out before finishing. 1 attempt so far. Brief generation for draft pull requests is off on this instance, so marking this pull request ready for review queues a new run.",
    );
  });

  it("is the reason alone when the card would show no note", () => {
    const detail = buildFailedPushDetail(appI18n.t, {
      generation: makeGeneration({ errorCode: "attempts-exhausted" }),
      offersRegenerate: true,
      prState: "open",
      appInstalled: true,
      awaitsReadyForReview: false,
    });

    expect(detail).toBe(appI18n.t("generationError.attempts-exhausted"));
  });
});
