import { startTestTracing, type TestTracing } from "logging/testing";
import { afterEach, describe, expect, it } from "vitest";
import { parseTenantContext } from "../src";
import { buildJobPayload } from "../src/stores/queue";
import { resolveScope } from "../src/stores/scope";

const HEAD = "a".repeat(40);

let tracing: TestTracing | undefined;

afterEach(async () => {
  await tracing?.stop();
  tracing = undefined;
});

function buildInstallationPayload() {
  const scope = resolveScope(parseTenantContext({ installationId: 42n }));
  return buildJobPayload(scope, undefined, 7n, HEAD);
}

describe("buildJobPayload trace context", () => {
  it("carries the enqueue's traceparent inside a trace", async () => {
    tracing = startTestTracing();
    let payload: ReturnType<typeof buildJobPayload> | undefined;
    const ids = await tracing.runInSpan(async () => {
      payload = buildInstallationPayload();
    });
    expect(payload?.traceparent).toBe(`00-${ids.traceId}-${ids.spanId}-01`);
  });
});
