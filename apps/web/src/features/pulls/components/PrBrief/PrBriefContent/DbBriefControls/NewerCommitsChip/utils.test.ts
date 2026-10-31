import { WaitReasons } from "contract";
import type { Mutable } from "types/utils";
import { describe, expect, it, vi } from "vitest";

import { omitFields } from "@web/test/fields";
import { appI18n } from "../../../../../../../i18n/I18nProvider";
import type { PrSummary } from "../../../../../types";
import { makeGenerationFields, makeMeta, makeUrlMeta } from "./test-utils";
import {
  NewerCommitsActionKinds,
  NewerCommitsStates,
  type NewerCommitsInput,
  type NewerCommitsStatus,
} from "./types";
import { deriveNewerCommitsStatus } from "./utils";

const LEAD =
  "This pull request has commits the brief you are reading does not cover.";
const ANCHOR =
  "Comments you leave here anchor to the revision you are reading.";
const TIMEOUT = "The model provider timed out before finishing.";
const RETRY_LINE = "Retry to run it again.";
const REPASTE_AFTER_PUSH =
  "A rerun of this push fails the same way. After a new push, paste this pull request's URL on the home page to brief it.";
const CANNOT_HELP_CODES = [
  "diff-too-large",
  "output-secret",
  "provider-refusal",
] as const;
const CLOSED_STATES = ["closed", "merged"] as const;
const DRAFTS_OFF = { draft: true, draftPolicy: { generate: false } } as const;

interface DeriveOptions {
  readonly staleHead?: boolean;
  readonly onGoToNewest?: () => void;
  readonly latestPending?: boolean;
  readonly pastePending?: boolean;
  readonly pasteFailure?: string;
  readonly pasteable?: boolean;
}

/** The runs the chip can start, spied so a test can tell which one an action fires. */
function stubRuns(options: DeriveOptions) {
  const latestTrigger = vi.fn();
  const pasteTrigger = vi.fn();
  const pasteRun: Mutable<NewerCommitsInput["pasteRun"]> = {
    pending: options.pastePending === true,
  };
  if (options.pasteable !== false) {
    pasteRun.trigger = pasteTrigger;
  }
  if (options.pasteFailure !== undefined) {
    pasteRun.failure = options.pasteFailure;
  }
  const latestRun = {
    pending: options.latestPending === true,
    trigger: latestTrigger,
  };
  return { latestRun, pasteRun, latestTrigger, pasteTrigger };
}

function deriveWithRuns(meta: PrSummary, options: DeriveOptions = {}) {
  const runs = stubRuns(options);
  const status = deriveNewerCommitsStatus(appI18n.t, {
    meta,
    staleHead: options.staleHead ?? true,
    onGoToNewest: options.onGoToNewest,
    latestRun: runs.latestRun,
    pasteRun: runs.pasteRun,
  });
  return { status, ...runs };
}

function derive(
  meta: PrSummary,
  options: DeriveOptions = {},
): NewerCommitsStatus | undefined {
  return deriveWithRuns(meta, options).status;
}

describe("deriveNewerCommitsStatus: when the chip shows", () => {
  it("shows nothing while the brief on screen covers the head", () => {
    const meta = makeMeta({ briefAvailable: true, behind: false });

    expect(derive(meta, { staleHead: false })).toBeUndefined();
  });

  it("names newer commits while reading an older head", () => {
    const status = derive(makeMeta());

    expect(status?.label).toBe("Newer commits");
    expect(status?.infoLabel).toBe("About newer commits");
    expect(status?.explanation[0]).toBe(LEAD);
    expect(status?.explanation.at(-1)).toBe(ANCHOR);
  });

  it("names newer commits when only GitHub is ahead of the latest brief", () => {
    const meta = makeMeta({
      briefAvailable: true,
      ...makeGenerationFields({ status: "succeeded" }),
    });
    const status = derive(meta, { staleHead: false });

    expect(status?.label).toBe("Newer commits");
    expect(status?.explanation).not.toContain(ANCHOR);
  });

  it("names a new base where a retargeted head has no brief on it", () => {
    const meta = makeMeta({ behind: false });
    const status = derive(meta, { staleHead: false });

    expect(status?.label).toBe("New base");
    expect(status?.infoLabel).toBe("About the new base");
    expect(status?.explanation[0]).toBe(
      "The brief you are reading covers this push on an earlier base.",
    );
    expect(status?.statusLabel).toBe("New brief failed");
    expect(status?.action?.kind).toBe(NewerCommitsActionKinds.RETRY);
  });
});

describe("deriveNewerCommitsStatus: a new base", () => {
  it("offers Generate on an awaiting head whose old base holds a brief", () => {
    const meta = makeMeta({
      behind: false,
      headBriefStored: true,
      ...makeGenerationFields({ status: "awaiting-trigger" }),
    });
    const status = derive(meta, { staleHead: false });

    expect(status?.label).toBe("New base");
    expect(status?.action?.label).toBe("Generate new brief");
  });
});

describe("deriveNewerCommitsStatus: a newer brief is stored", () => {
  it("offers Go to new brief alone once the latest push has its brief", () => {
    const onGoToNewest = vi.fn();
    const covered = makeMeta({
      briefAvailable: true,
      headBriefStored: true,
      behind: false,
      ...makeGenerationFields({ status: "succeeded" }),
    });
    const status = derive(covered, { onGoToNewest });

    expect(status?.state).toBe(NewerCommitsStates.NEW_BRIEF);
    expect(status?.statusLabel).toBeUndefined();
    expect(status?.title).toBe("New brief ready");
    expect(status?.action?.label).toBe("Go to new brief");
    expect(status?.runAction).toBeUndefined();
    status?.action?.onTrigger();
    expect(onGoToNewest).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed latest push and its Retry beside the newer brief", () => {
    const onGoToNewest = vi.fn();
    const { status, latestTrigger } = deriveWithRuns(makeMeta(), {
      onGoToNewest,
    });

    expect(status?.state).toBe(NewerCommitsStates.FAILED);
    expect(status?.statusLabel).toBe("New brief failed");
    expect(status?.action?.label).toBe("Go to newer brief");
    expect(status?.explanation).toContain(
      "A newer brief is ready to read. It does not cover the latest push.",
    );
    status?.action?.onTrigger();
    expect(onGoToNewest).toHaveBeenCalledTimes(1);
    expect(status?.runAction?.label).toBe("Retry");
    status?.runAction?.onTrigger();
    expect(latestTrigger).toHaveBeenCalledTimes(1);
  });

  it.each([
    { head: "failed", fields: {}, runLabel: "Retry" },
    {
      head: "awaiting",
      fields: makeGenerationFields({ status: "awaiting-trigger" }),
      runLabel: "Generate new brief",
    },
  ])(
    "names an earlier base beside the newer brief: $head head",
    ({ fields, runLabel }) => {
      const meta = makeMeta({
        behind: false,
        headBriefStored: true,
        ...fields,
      });
      const status = derive(meta, { onGoToNewest: vi.fn() });

      expect(status?.explanation).toContain(
        "A newer brief is ready to read. It covers the latest push on an earlier base.",
      );
      expect(status?.explanation).not.toContain(
        "A newer brief is ready to read. It does not cover the latest push.",
      );
      expect(status?.action?.label).toBe("Go to newer brief");
      expect(status?.runAction?.label).toBe(runLabel);
    },
  );

  it("keeps a newer push's hand-over beside the newer brief", () => {
    const superseded = makeMeta(makeGenerationFields({ status: "superseded" }));
    const status = derive(superseded, { onGoToNewest: vi.fn() });

    expect(status?.state).toBe(NewerCommitsStates.GENERATING);
    expect(status?.action?.label).toBe("Go to newer brief");
    expect(status?.explanation).toContain(
      "A newer push replaced the one being briefed. The brief for the newest push comes next.",
    );
  });

  it("says no new brief beside the newer one while GitHub is ahead", () => {
    const meta = makeMeta({
      briefAvailable: true,
      headBriefStored: true,
      ...makeGenerationFields({ status: "succeeded" }),
    });
    const status = derive(meta, { onGoToNewest: vi.fn() });

    expect(status?.statusLabel).toBe("No new brief");
    expect(status?.action?.label).toBe("Go to newer brief");
  });

  it("names an on-demand latest push beside the newer brief", () => {
    const awaiting = makeMeta(
      makeGenerationFields({ status: "awaiting-trigger" }),
    );
    const status = derive(awaiting, { onGoToNewest: vi.fn() });

    expect(status?.statusLabel).toBe("New brief on demand");
    expect(status?.runAction?.label).toBe("Generate new brief");
  });

  it("never offers it on the same head, where no newer commits exist", () => {
    const status = derive(makeMeta({ behind: false }), {
      staleHead: false,
      onGoToNewest: vi.fn(),
    });

    expect(status?.state).toBe(NewerCommitsStates.FAILED);
  });
});

describe("deriveNewerCommitsStatus: the latest push generates", () => {
  it("shows a running push as generating, with no action", () => {
    const meta = makeMeta(makeGenerationFields({ status: "running" }));
    const status = derive(meta);

    expect(status?.state).toBe(NewerCommitsStates.GENERATING);
    expect(status?.statusLabel).toBe("Generating new brief");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toEqual([
      LEAD,
      "MergeBrief is generating the latest push's brief. Once it is ready, this chip takes you to it.",
      ANCHOR,
    ]);
  });

  it("says why a pending push has not started", () => {
    const meta = makeMeta(
      makeGenerationFields({
        status: "pending",
        waitReason: WaitReasons.WAITING_FOR_SLOT,
      }),
    );

    expect(derive(meta)?.explanation).toContain(
      "Other briefs are generating. This one starts when a slot frees up.",
    );
  });

  it("gives the author of a damped draft its refresh window", () => {
    const meta = makeMeta({
      ...makeGenerationFields({ status: "pending" }),
      draft: true,
      viewerIsAuthor: true,
      draftPolicy: { generate: true, debounceSeconds: 900 },
    });

    expect(derive(meta)?.explanation.join(" ")).toContain("15 minutes");
  });

  const stalled = makeGenerationFields({
    status: "pending",
    waitReason: WaitReasons.STALLED,
  });

  it("calls a stalled push stopped and names what queues its next run", () => {
    const status = derive(makeMeta(stalled));

    expect(status?.state).toBe(NewerCommitsStates.STALLED);
    expect(status?.statusLabel).toBe("New brief stopped");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "No brief is on the way for this push.",
    );
    expect(status?.explanation).toContain(
      "A new push, a submitted review or a review request queues a new run.",
    );
  });

  it("generates a stalled url row's brief through the paste", () => {
    const { status, pasteTrigger } = deriveWithRuns(makeUrlMeta(stalled));

    expect(status?.state).toBe(NewerCommitsStates.STALLED);
    expect(status?.action?.label).toBe("Generate new brief");
    status?.action?.onTrigger();
    expect(pasteTrigger).toHaveBeenCalledTimes(1);
  });

  it("points a stalled url row with no known URL at a paste", () => {
    const status = derive(makeUrlMeta(stalled), { pasteable: false });

    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "Paste this pull request's URL on the home page to retry it.",
    );
  });
});

describe("deriveNewerCommitsStatus: the latest push waits on demand", () => {
  const awaiting = makeGenerationFields({ status: "awaiting-trigger" });

  it("offers a pusher Generate alone", () => {
    const { status, latestTrigger } = deriveWithRuns(makeMeta(awaiting));

    expect(status?.state).toBe(NewerCommitsStates.ON_DEMAND);
    expect(status?.statusLabel).toBeUndefined();
    expect(status?.title).toBe("New brief on demand");
    expect(status?.action?.label).toBe("Generate new brief");
    status?.action?.onTrigger();
    expect(latestTrigger).toHaveBeenCalledTimes(1);
  });

  it("names the wait for anyone else and offers nothing", () => {
    const status = derive(makeMeta({ ...awaiting, viewerCanPush: false }));

    expect(status?.statusLabel).toBe("New brief on demand");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "A collaborator with push access can generate this pull request's brief. After that, its pushes are briefed as usual.",
    );
  });

  it("promises a drafts-off draft briefs only once it is ready", () => {
    const status = derive(makeMeta({ ...awaiting, ...DRAFTS_OFF }));

    expect(status?.explanation.join(" ")).toMatch(
      /pushes are briefed once it is marked ready for review/,
    );
    expect(status?.explanation.join(" ")).not.toMatch(
      /its pushes are briefed as usual/,
    );
  });

  it.each(CLOSED_STATES)("says no new brief comes on a %s PR", (state) => {
    const status = derive(makeMeta({ ...awaiting, state }));

    expect(status?.state).toBe(NewerCommitsStates.NO_BRIEF);
    expect(status?.statusLabel).toBe("No new brief");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "This pull request is no longer open, so its brief will not be generated.",
    );
  });
});

describe("deriveNewerCommitsStatus: the latest push failed", () => {
  it("offers a pusher Retry on a transient failure", () => {
    const { status, latestTrigger } = deriveWithRuns(makeMeta());

    expect(status?.statusLabel).toBe("New brief failed");
    expect(status?.action?.label).toBe("Retry");
    expect(status?.explanation).toEqual([
      LEAD,
      `${TIMEOUT} 1 attempt so far.`,
      RETRY_LINE,
      ANCHOR,
    ]);
    status?.action?.onTrigger();
    expect(latestTrigger).toHaveBeenCalledTimes(1);
  });

  it("names the retry in flight", () => {
    const status = derive(makeMeta(), { latestPending: true });

    expect(status?.action?.label).toBe("Retrying…");
    expect(status?.action?.pending).toBe(true);
  });

  it("offers no Retry where a rerun cannot help", () => {
    const meta = makeMeta(
      makeGenerationFields({ errorCode: "diff-too-large" }),
    );
    const status = derive(meta);

    expect(status?.statusLabel).toBe("New brief failed");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "The diff is too large to summarize. MergeBrief briefs a pull request only when it changes up to 3,000 files and GitHub serves its whole diff. 1 attempt so far. A new push re-queues generation automatically.",
    );
  });

  it("offers no Retry to a viewer without push access", () => {
    const status = derive(makeMeta({ viewerCanPush: false }));

    expect(status?.action).toBeUndefined();
    expect(status?.explanation).not.toContain(RETRY_LINE);
  });

  it.each(CLOSED_STATES)("offers no Retry on a %s PR and says so", (state) => {
    const status = derive(makeMeta({ state }));

    expect(status?.action).toBeUndefined();
    expect(status?.explanation.join(" ")).toContain(
      "This pull request is no longer open, so no brief will generate.",
    );
  });

  it("points a drafts-off draft at ready for review", () => {
    const status = derive(makeMeta({ ...DRAFTS_OFF, viewerCanPush: false }));

    expect(status?.explanation.join(" ")).toMatch(
      /marking this pull request ready for review queues a new run/,
    );
  });

  it("generates a url row's newer head through the paste, not the route", () => {
    const { status, latestTrigger, pasteTrigger } =
      deriveWithRuns(makeUrlMeta());

    expect(status?.action?.label).toBe("Generate new brief");
    expect(status?.explanation).not.toContain(RETRY_LINE);
    expect(status?.explanation.join(" ")).not.toMatch(/Paste this/);
    status?.action?.onTrigger();
    expect(pasteTrigger).toHaveBeenCalledTimes(1);
    expect(latestTrigger).not.toHaveBeenCalled();
  });

  it("points a url row with no known URL at a paste", () => {
    const status = derive(makeUrlMeta(), { pasteable: false });

    expect(status?.action).toBeUndefined();
    expect(status?.explanation.join(" ")).toContain(
      "Paste this pull request's URL on the home page to retry it.",
    );
  });

  it.each(CANNOT_HELP_CODES)(
    "offers no paste of a url head that failed as %s",
    (errorCode) => {
      const meta = makeUrlMeta(makeGenerationFields({ errorCode }));
      const { status, pasteTrigger } = deriveWithRuns(meta);

      expect(status?.state).toBe(NewerCommitsStates.FAILED);
      expect(status?.action).toBeUndefined();
      expect(status?.explanation.join(" ")).toContain(REPASTE_AFTER_PUSH);
      expect(pasteTrigger).not.toHaveBeenCalled();
    },
  );

  it.each(CANNOT_HELP_CODES)(
    "keeps only the newer url brief's link after a %s failure",
    (errorCode) => {
      const meta = makeUrlMeta(makeGenerationFields({ errorCode }));
      const onGoToNewest = vi.fn();
      const status = derive(meta, { onGoToNewest });

      expect(status?.action?.kind).toBe(NewerCommitsActionKinds.NAVIGATE);
      expect(status?.runAction).toBeUndefined();
      expect(status?.explanation.join(" ")).toContain(REPASTE_AFTER_PUSH);
      status?.action?.onTrigger();
      expect(onGoToNewest).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["provider-auth", "generation-config", "github-access"] as const)(
    "keeps a url row's paste after a fix-first %s failure",
    (errorCode) => {
      const meta = makeUrlMeta(makeGenerationFields({ errorCode }));
      const status = derive(meta);

      expect(status?.action?.kind).toBe(NewerCommitsActionKinds.GENERATE);
      expect(status?.explanation.join(" ")).not.toContain(REPASTE_AFTER_PUSH);
    },
  );

  it.each(CLOSED_STATES)(
    "keeps a %s url row's paste after a transient failure",
    (state) => {
      const status = derive(makeUrlMeta({ state }));

      expect(status?.action?.kind).toBe(NewerCommitsActionKinds.GENERATE);
    },
  );

  it("calls a spent head out of attempts and still offers Retry", () => {
    const meta = makeMeta(
      makeGenerationFields({ errorCode: "attempts-exhausted" }),
    );
    const status = derive(meta);

    expect(status?.state).toBe(NewerCommitsStates.EXHAUSTED);
    expect(status?.statusLabel).toBe("New brief out of attempts");
    expect(status?.action?.label).toBe("Retry");
  });

  it("tells anyone else what queues a spent head again", () => {
    const meta = makeMeta({
      ...makeGenerationFields({ errorCode: "attempts-exhausted" }),
      viewerCanPush: false,
    });
    const status = derive(meta);

    expect(status?.action).toBeUndefined();
    expect(status?.explanation.join(" ")).toContain(
      "A new push, a submitted review or a review request queues a new run.",
    );
  });
});

describe("deriveNewerCommitsStatus: the latest push was skipped", () => {
  const capped = makeGenerationFields({ status: "capped" });

  it("calls it skipped, never paused, and names the next push", () => {
    const status = derive(makeMeta(capped));

    expect(status?.state).toBe(NewerCommitsStates.SKIPPED);
    expect(status?.statusLabel).toBe("New brief skipped");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "This instance reached its daily generation cap, so this push was skipped.",
    );
    expect(status?.explanation.join(" ")).toMatch(/next push after the reset/);
  });

  it.each(CLOSED_STATES)("promises nothing on a %s PR", (state) => {
    const status = derive(makeMeta({ ...capped, state }));

    expect(status?.explanation.join(" ")).not.toMatch(/next push/);
    expect(status?.explanation.join(" ")).toContain("no longer open");
  });

  it("points a drafts-off draft at ready for review", () => {
    const status = derive(makeMeta({ ...capped, ...DRAFTS_OFF }));

    expect(status?.explanation.join(" ")).toMatch(/ready for review/);
    expect(status?.explanation.join(" ")).not.toMatch(/next push/);
  });

  it("tells a url row to generate after the reset while it has not passed", () => {
    vi.useFakeTimers({ now: new Date("2026-10-24T12:00:00.000Z") });
    const status = derive(makeUrlMeta(capped));
    vi.useRealTimers();

    expect(status?.explanation).toContain(
      "Generate the new brief after the reset.",
    );
  });

  it("drops the wait once the reset has passed", () => {
    vi.useFakeTimers({ now: new Date("2026-10-25T01:00:00.000Z") });
    const status = derive(makeUrlMeta(capped));
    vi.useRealTimers();

    expect(status?.explanation).toContain("Generation has since resumed.");
    expect(status?.explanation).not.toContain(
      "Generate the new brief after the reset.",
    );
  });

  it("names the runs a large url row needed and what was left", () => {
    const units = makeGenerationFields({
      status: "capped",
      cappedUnits: { needed: 9, left: 4, cap: 20 },
    });
    const status = derive(makeUrlMeta(units));

    expect(status?.explanation).toContain(
      "This push needs 9 more runs to be briefed in parts, and this instance had 4 left today.",
    );
    expect(status?.explanation.join(" ")).not.toMatch(/reached its daily/);
  });

  it("leads an installation row's large run with the runs, not the cap", () => {
    const units = makeGenerationFields({
      status: "capped",
      cappedUnits: { needed: 9, left: 4, cap: 9 },
    });
    const status = derive(makeMeta(units));

    expect(status?.explanation).toContain(
      "This push needed more runs than this instance had left, so it was skipped.",
    );
    expect(status?.explanation.join(" ")).not.toMatch(/reached its daily/);
  });

  it("names the cap on a url row no day can fit, not the reset", () => {
    const units = makeGenerationFields({
      status: "capped",
      cappedUnits: { needed: 9, left: 4, cap: 9 },
    });
    const status = derive(makeUrlMeta(units));

    expect(status?.explanation).toContain(
      "This push needs 9 more runs to be briefed in parts, and this instance's daily cap of 9 cannot fit that in one day.",
    );
    expect(status?.explanation).toContain(
      "No push or retry is briefed until the instance operator raises the daily cap.",
    );
    expect(status?.explanation).not.toContain(
      "Generate the new brief after the reset.",
    );
  });

  it("keeps a url row's paste as Generate, without a paste instruction", () => {
    const { status, pasteTrigger } = deriveWithRuns(makeUrlMeta(capped));

    expect(status?.action?.label).toBe("Generate new brief");
    expect(status?.explanation.join(" ")).not.toMatch(/Paste this/);
    status?.action?.onTrigger();
    expect(pasteTrigger).toHaveBeenCalledTimes(1);
  });
});

describe("deriveNewerCommitsStatus: no run covers the newer commits", () => {
  const covered = {
    briefAvailable: true,
    ...makeGenerationFields({ status: "succeeded" }),
  } as const;

  it("says no run is queued yet on an open installation row", () => {
    const status = derive(makeMeta(covered));

    expect(status?.state).toBe(NewerCommitsStates.NO_BRIEF);
    expect(status?.statusLabel).toBe("No new brief");
    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "No run is queued for the newer commits yet.",
    );
  });

  it.each(CLOSED_STATES)("says none will generate on a %s PR", (state) => {
    const status = derive(makeMeta({ ...covered, state }));

    expect(status?.explanation).toContain(
      "This pull request is no longer open, so no brief will generate.",
    );
  });

  it("names ready for review on a drafts-off draft, whoever reads it", () => {
    const status = derive(
      makeMeta({ ...covered, ...DRAFTS_OFF, viewerIsAuthor: false }),
    );

    expect(status?.statusLabel).toBe("No new brief");
    expect(status?.explanation).toContain(
      "Brief generation for draft pull requests is off on this instance, so nothing is generated until this pull request is marked ready for review.",
    );
  });

  it.each(["open", "closed"] as const)(
    "offers a %s url row Generate through the paste",
    (state) => {
      const { status, pasteTrigger } = deriveWithRuns(
        makeUrlMeta({ ...covered, state }),
      );

      expect(status?.statusLabel).toBeUndefined();
      expect(status?.title).toBe("New brief not generated");
      expect(status?.action?.label).toBe("Generate new brief");
      status?.action?.onTrigger();
      expect(pasteTrigger).toHaveBeenCalledTimes(1);
    },
  );

  it("names the paste in flight", () => {
    const status = derive(makeUrlMeta(covered), { pastePending: true });

    expect(status?.action?.label).toBe("Generating…");
    expect(status?.action?.pending).toBe(true);
  });

  it("shows the paste's refusal until the next one", () => {
    const status = derive(makeUrlMeta(covered), {
      pasteFailure: "Your session expired.",
    });

    expect(status?.failure).toBe("Your session expired.");
  });

  it("points a url row with no known URL at the home page", () => {
    const status = derive(makeUrlMeta(covered), { pasteable: false });

    expect(status?.action).toBeUndefined();
    expect(status?.explanation).toContain(
      "Paste this pull request's URL on the home page to generate the new brief.",
    );
  });

  it("offers no paste while GitHub is not ahead", () => {
    const meta = makeUrlMeta({ ...covered, behind: false });
    const status = derive(meta, { staleHead: true });

    expect(status?.state).toBe(NewerCommitsStates.NO_BRIEF);
    expect(status?.action).toBeUndefined();
  });

  it("offers a url row the paste while its covered brief warms", () => {
    const warming = {
      briefAvailable: true,
      headBriefStored: true,
      ...makeGenerationFields({ status: "running" }),
    };
    const status = derive(makeUrlMeta(warming));

    expect(status?.state).toBe(NewerCommitsStates.NO_BRIEF);
    expect(status?.action?.kind).toBe(NewerCommitsActionKinds.GENERATE);
  });

  it("never calls a stalled url row generating", () => {
    const stalled = {
      briefAvailable: true,
      ...makeGenerationFields({
        status: "pending",
        waitReason: WaitReasons.STALLED,
      }),
    };

    const meta = makeUrlMeta(stalled);
    expect(derive(meta)?.state).toBe(NewerCommitsStates.NO_BRIEF);
  });

  it("falls back to no new brief when the meta carries no generation", () => {
    const meta = omitFields(makeMeta(covered), "generation");

    expect(derive(meta)?.state).toBe(NewerCommitsStates.NO_BRIEF);
  });
});

describe("deriveNewerCommitsStatus: a newer push took over", () => {
  const superseded = makeGenerationFields({ status: "superseded" });

  it("shows the hand-over as generating", () => {
    const status = derive(makeMeta(superseded));

    expect(status?.state).toBe(NewerCommitsStates.GENERATING);
    expect(status?.explanation).toContain(
      "A newer push replaced the one being briefed. The brief for the newest push comes next.",
    );
  });

  it.each(CLOSED_STATES)("says none will generate on a %s PR", (state) => {
    const status = derive(makeMeta({ ...superseded, state }));

    expect(status?.state).toBe(NewerCommitsStates.NO_BRIEF);
    expect(status?.explanation).toContain(
      "This pull request is no longer open, so no brief will generate.",
    );
  });

  it("waits for ready for review on a drafts-off draft", () => {
    const status = derive(makeMeta({ ...superseded, ...DRAFTS_OFF }));

    expect(status?.state).toBe(NewerCommitsStates.NO_BRIEF);
    expect(status?.explanation.join(" ")).toMatch(/ready for review/);
  });
});
