import { afterEach, describe, expect, it } from "vitest";
import { nameRequestSpan, traceMethods, traceStep } from "../src/spans";
import { startTestTracing, type TestTracing } from "../src/testing";

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

function requireTracing(): TestTracing {
  if (tracing === undefined) {
    throw new Error("tracing not started");
  }
  return tracing;
}

describe("traceStep", () => {
  it("runs the step with tracing off and returns its result", async () => {
    const result = await traceStep("step", {}, async () => 42);

    expect(result).toBe(42);
  });

  it("opens a named child span carrying its attributes", async () => {
    tracing = startTestTracing();
    const parent = await tracing.runInSpan(async () => {
      await traceStep(
        "generation.decide",
        { "mergebrief.kind": "brief" },
        (span) => {
          span.setAttributes({ "mergebrief.decision": "fresh" });
          return Promise.resolve();
        },
      );
    });

    const [step] = requireTracing().readFinishedSpans();
    expect(step).toMatchObject({
      name: "generation.decide",
      parentSpanId: parent.spanId,
      attributes: {
        "mergebrief.kind": "brief",
        "mergebrief.decision": "fresh",
      },
      failed: false,
    });
  });

  it("reports whether the span will export", async () => {
    const off = await traceStep("step", {}, async (span) => span.isRecording());
    tracing = startTestTracing();
    const on = await traceStep("step", {}, async (span) => span.isRecording());

    expect(off).toBe(false);
    expect(on).toBe(true);
  });

  it("marks the span failed and rethrows the step's error", async () => {
    tracing = startTestTracing();
    const failing = traceStep("step", {}, () =>
      Promise.reject(new Error("provider down")),
    );

    await expect(failing).rejects.toThrow("provider down");
    const [step] = requireTracing().readFinishedSpans();
    expect(step?.failed).toBe(true);
    expect(JSON.stringify(step)).not.toContain("provider down");
  });
});

describe("traceStep failure predicate", () => {
  it("leaves the span unfailed for a throw the step expects", async () => {
    tracing = startTestTracing();
    const expected = traceStep(
      "step",
      {},
      () => Promise.reject(new Error("not found")),
      { isFailure: () => false },
    );

    await expect(expected).rejects.toThrow("not found");
    const [step] = requireTracing().readFinishedSpans();
    expect(step?.failed).toBe(false);
  });
});

describe("traceMethods", () => {
  function makeStore() {
    return {
      scope: "installation",
      async get(id: number) {
        return { id, title: "secret title" };
      },
      count() {
        return 3;
      },
      async refuse() {
        throw new Error("scope violation");
      },
    };
  }

  function findSpan(name: string) {
    const spans = requireTracing().readFinishedSpans();
    return spans.find((span) => span.name === name);
  }

  it("names a span for each async method call and keeps its result", async () => {
    tracing = startTestTracing();
    const store = traceMethods("briefs", makeStore());
    let row: unknown;

    const parent = await tracing.runInSpan(async () => {
      row = await store.get(7);
    });

    expect(row).toEqual({ id: 7, title: "secret title" });
    const call = findSpan("briefs.get");
    expect(call).toMatchObject({ parentSpanId: parent.spanId, failed: false });
    expect(JSON.stringify(call)).not.toContain("secret title");
  });

  it("ends a sync method's span on return", async () => {
    tracing = startTestTracing();
    const store = traceMethods("briefs", makeStore());
    let count: unknown;

    await tracing.runInSpan(async () => {
      count = store.count();
    });

    expect(count).toBe(3);
    expect(findSpan("briefs.count")).toBeDefined();
  });

  it("marks the span failed on a rejection and rethrows it", async () => {
    tracing = startTestTracing();
    const store = traceMethods("briefs", makeStore());

    await tracing.runInSpan(async () => {
      await expect(store.refuse()).rejects.toThrow("scope violation");
    });

    const call = findSpan("briefs.refuse");
    expect(call?.failed).toBe(true);
    expect(JSON.stringify(call)).not.toContain("scope violation");
  });

  it("nests an async method's queries under its span", async () => {
    tracing = startTestTracing();
    const store = traceMethods("briefs", {
      async get() {
        await traceStep("pg.query", {}, async () => undefined);
      },
    });

    await tracing.runInSpan(async () => {
      await store.get();
    });

    expect(findSpan("pg.query")?.parentSpanId).toBe(
      findSpan("briefs.get")?.spanId,
    );
  });

  it("nests a lazy query builder's query under its span", async () => {
    tracing = startTestTracing();
    const builder: PromiseLike<number> = {
      // oxlint-disable-next-line unicorn/no-thenable -- stands in for a lazy drizzle query builder
      then: (onFulfilled, onRejected) =>
        traceStep("pg.query", {}, async () => 5).then(onFulfilled, onRejected),
    };
    const store = traceMethods("briefs", {
      listForPullRequest: () => builder,
    });
    let rows: unknown;

    await tracing.runInSpan(async () => {
      rows = await store.listForPullRequest();
    });

    expect(rows).toBe(5);
    expect(findSpan("pg.query")?.parentSpanId).toBe(
      findSpan("briefs.listForPullRequest")?.spanId,
    );
  });

  it("opens no span for a call outside any trace", async () => {
    tracing = startTestTracing();
    const store = traceMethods("briefs", makeStore());

    await store.get(7);

    const spans = requireTracing().readFinishedSpans();
    expect(spans).toEqual([]);
  });

  it("leaves the span unfailed for a rejection the store expects", async () => {
    tracing = startTestTracing();
    const store = traceMethods("briefs", makeStore(), {
      isFailure: () => false,
    });

    await tracing.runInSpan(async () => {
      await expect(store.refuse()).rejects.toThrow("scope violation");
    });

    expect(findSpan("briefs.refuse")?.failed).toBe(false);
  });

  it("passes data fields through untouched", () => {
    const store = traceMethods("briefs", makeStore());

    expect(store.scope).toBe("installation");
  });
});

describe("nameRequestSpan", () => {
  it("names the active span for its route and records the route", async () => {
    tracing = startTestTracing();
    await tracing.runInSpan(async () => {
      nameRequestSpan("POST", "/api/webhooks/github");
    });

    const [request] = requireTracing().readFinishedSpans();
    expect(request?.name).toBe("POST /api/webhooks/github");
    expect(request?.attributes["http.route"]).toBe("/api/webhooks/github");
  });

  it("does nothing outside a span", () => {
    expect(() => nameRequestSpan("GET", "/api/version")).not.toThrow();
  });
});
