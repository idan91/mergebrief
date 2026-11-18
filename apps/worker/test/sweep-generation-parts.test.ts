// The scheduled generation part sweep against a real migrated schema (the
// `persistence/testing` PGlite harness). Parts are seeded through the store a
// multi-call run writes with.
import {
  createGenerationPartStore,
  GenerationPartKinds,
  type GenerationSpan,
} from "persistence";
import { describe, expect, it } from "vitest";
import { createSweepGenerationPartsTask } from "../src/task/sweep-generation-parts";
import {
  BASE,
  captureLogger,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  setUpHarness,
  trigger,
} from "./generate/helpers";

setUpHarness();

async function seedSpans(): Promise<readonly GenerationSpan[]> {
  const { pr } = await trigger(HEAD_1);
  const store = createGenerationPartStore(harness.handle, ctx);
  const spans = [HEAD_1, HEAD_2].map((headSha) => ({
    pullRequestId: pr.id,
    baseSha: BASE,
    headSha,
  }));
  for (const span of spans) {
    await store.write({
      ...span,
      partKey: "detail:1",
      body: { kind: GenerationPartKinds.DETAIL, chunks: [] },
    });
  }
  return spans;
}

async function ageParts(headSha: string, days: number): Promise<void> {
  await harness.raw(
    `update generation_part set created_at = now() - interval '${String(days)} days' where head_sha = '${headSha}'`,
  );
}

describe("sweep-generation-parts task", () => {
  it("deletes the parts of a span idle past a week and logs the count", async () => {
    const spans = await seedSpans();
    await ageParts(HEAD_1, 8);
    const { logger, readLines } = captureLogger();

    await createSweepGenerationPartsTask({
      handle: harness.handle,
      log: logger,
    })();

    const store = createGenerationPartStore(harness.handle, ctx);
    const remaining = await Promise.all(
      spans.map((span) => store.listForSpan(span)),
    );
    expect(remaining.map((rows) => rows.length)).toEqual([0, 1]);
    expect(readLines()).toEqual([
      expect.objectContaining({
        level: "info",
        msg: "sweep-generation-parts: deleted 1 stored parts of idle spans",
      }),
    ]);
  });

  it("logs nothing when no span is idle past a week", async () => {
    await seedSpans();
    const { logger, readLines } = captureLogger();

    await createSweepGenerationPartsTask({
      handle: harness.handle,
      log: logger,
    })();

    const rows = await harness.raw(
      "select count(*)::int as n from generation_part",
    );
    expect(rows[0]?.["n"]).toBe(2);
    expect(readLines()).toEqual([]);
  });
});
