// A large run claims the units its detail calls cost; at the cap it ends
// `capped`, naming the runs it needed and what the day had left.
import { createI18n } from "i18n";
import {
  createGenerationProjection,
  type GenerationProjection,
} from "persistence";
import { claimTestRun } from "persistence/testing";
import { GenerationStatuses } from "types/generations";
import { describe, expect, it } from "vitest";
import {
  claimRunUnits,
  SpendCappedSignal,
} from "../../src/task/generate/logic/spend-gate";
import { HeadReadings, type RunContext } from "../../src/task/generate/types";
import {
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  makeTarget,
  PUBLIC_URL,
  setUpHarness,
  trigger,
} from "./helpers";

setUpHarness();

const ENTRY_ID = 77n;

interface UnitsRun {
  readonly context: RunContext;
  readonly projection: GenerationProjection;
  readonly bodies: string[];
  readonly readLines: () => Array<Record<string, unknown>>;
}

async function startUnitsRun(
  cap: number | null,
  entryId: bigint | null = null,
): Promise<UnitsRun> {
  const { pr } = await trigger(HEAD_1);
  const projection = createGenerationProjection(harness.handle, ctx);
  const target = makeTarget(pr, HEAD_1);
  const runId = await claimTestRun(projection, target);
  const { logger, readLines } = captureLogger();
  const bodies: string[] = [];
  const context = {
    deps: {
      spend: { maxGenerationsPerDay: cap },
      translate: createI18n().t,
      publicBaseUrl: PUBLIC_URL,
    },
    payload: { headSha: HEAD_1 },
    projection,
    target,
    run: { leaveRow: false, providerCalls: 1, runId },
    repoSlug: "acme/widget",
    prRow: pr,
    existingBrief: undefined,
    entryCommentManager: {
      getCurrentId: () => entryId,
      refresh: (body: string) => {
        bodies.push(body);
        return Promise.resolve({ kind: "written" });
      },
    },
    watch: {
      readHead: () => Promise.resolve({ kind: HeadReadings.CURRENT }),
    },
    log: logger,
  } as unknown as RunContext;
  return { context, projection, bodies, readLines };
}

describe("claimRunUnits", () => {
  it("charges the units under the cap and lets the run go on", async () => {
    const { context, projection } = await startUnitsRun(10);

    await claimRunUnits(context, 4);

    const started = await projection.countStartedRuns({
      from: new Date(0),
      to: new Date("2100-01-01T00:00:00.000Z"),
    });
    expect(started).toBe(5);
  });

  it("ends the run capped with the runs it needed and the day's rest", async () => {
    const { context, projection, readLines } = await startUnitsRun(3);

    await expect(claimRunUnits(context, 4)).rejects.toBeInstanceOf(
      SpendCappedSignal,
    );

    const row = await projection.get(context.target);
    expect(row).toMatchObject({
      status: GenerationStatuses.CAPPED,
      errorParams: { needed: 4, left: 2, cap: 3 },
      runId: null,
    });
    const trip = readLines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip).toMatchObject({
      cap: 3,
      headSha: HEAD_1,
      needed: 4,
      left: 2,
    });
  });

  it("promises the next push to a run a fresh day can fit", async () => {
    const { context, bodies, readLines } = await startUnitsRun(5, ENTRY_ID);
    await claimRunUnits(context, 3);

    await expect(claimRunUnits(context, 4)).rejects.toBeInstanceOf(
      SpendCappedSignal,
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain(
      "this pull request needs 4 more runs to be briefed in parts, and this instance had 1 left today",
    );
    expect(bodies[0]).toContain(
      "The next push after that is briefed as usual.",
    );
    const trip = readLines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip?.["msg"]).toContain("large run refused");
  });

  it("names the cap, not the next push, when no day can fit the run", async () => {
    const { context, projection, bodies, readLines } = await startUnitsRun(
      3,
      ENTRY_ID,
    );

    await expect(claimRunUnits(context, 3)).rejects.toBeInstanceOf(
      SpendCappedSignal,
    );

    const row = await projection.get(context.target);
    expect(row?.errorParams).toEqual({ needed: 3, left: 2, cap: 3 });
    expect(bodies[0]).toContain(
      "this pull request needs 3 more runs to be briefed in parts, and this instance's daily cap of 3 cannot fit that in one day",
    );
    expect(bodies[0]).toContain(
      "until the instance operator raises the daily cap",
    );
    expect(bodies[0]).not.toContain("next push");
    const trip = readLines().find((line) => line["evt"] === "spend.cap.trip");
    expect(trip?.["msg"]).toContain("more runs than the daily cap");
  });

  it("charges an uncapped instance whatever the count", async () => {
    const { context, projection } = await startUnitsRun(null);

    await claimRunUnits(context, 40);

    const row = await projection.get(context.target);
    expect(row?.status).toBe(GenerationStatuses.RUNNING);
  });
});
