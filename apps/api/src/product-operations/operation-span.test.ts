import { Hono } from "hono";
import { every } from "hono/combine";
import { startTestTracing, type TestTracing } from "logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import { NotFound } from "../shared-errors/api-error";
import { traceOperation } from "./operation-span";

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

function buildApp(status: 200 | 500): Hono {
  const app = new Hono();
  app.get("/brief", traceOperation("read-brief"), (context) =>
    context.json({}, status),
  );
  return app;
}

/** Composed as the product router composes an operation, so a throw escapes. */
function buildThrowingApp(error: Error): Hono {
  const app = new Hono();
  const traced = every(traceOperation("read-brief"), () => {
    throw error;
  });
  app.get("/brief", traced);
  return app;
}

describe("traceOperation", () => {
  it("opens a span named for the operation around its handlers", async () => {
    tracing = startTestTracing();

    await buildApp(200).request("/brief");

    const [operation] = tracing.readFinishedSpans();
    expect(operation).toMatchObject({
      name: "read-brief",
      attributes: { "mergebrief.operation": "read-brief" },
      failed: false,
    });
  });

  it("leaves the span unfailed when the operation throws a 4xx", async () => {
    tracing = startTestTracing();

    const app = buildThrowingApp(new NotFound());
    await app.request("/brief");

    const [operation] = tracing.readFinishedSpans();
    expect(operation?.failed).toBe(false);
  });

  it("marks the span failed when the operation throws a server fault", async () => {
    tracing = startTestTracing();

    const app = buildThrowingApp(new Error("pool exhausted"));
    await app.request("/brief");

    const [operation] = tracing.readFinishedSpans();
    expect(operation?.failed).toBe(true);
  });

  it("marks the span failed when the operation answers a 5xx", async () => {
    tracing = startTestTracing();

    await buildApp(500).request("/brief");

    const [operation] = tracing.readFinishedSpans();
    expect(operation?.failed).toBe(true);
  });
});
