import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const runFile = promisify(execFile);
const FIXTURE = fileURLToPath(new URL("fixtures/two-hops.ts", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const INBOUND_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const INBOUND_SPAN_ID = "00f067aa0ba902b7";
const SERVER_KIND = 1;
const CLIENT_KIND = 2;
const FIXTURE_TIMEOUT_MS = 15_000;

interface ExportedSpan {
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  urlFull?: string;
  urlPath?: string;
}

// A child process, because the http instrumentation must register before
// `node:http` loads, and a vitest worker has loaded it already.
async function runTwoHops(): Promise<ExportedSpan[]> {
  const traceparent = `00-${INBOUND_TRACE_ID}-${INBOUND_SPAN_ID}-01`;
  const { stdout } = await runFile(
    process.execPath,
    ["--import", "tsx", FIXTURE, traceparent],
    { cwd: PACKAGE_ROOT, timeout: FIXTURE_TIMEOUT_MS },
  );
  return JSON.parse(stdout) as ExportedSpan[];
}

describe("trace propagation through a proxied hop", () => {
  let spans: ExportedSpan[] = [];

  beforeAll(async () => {
    spans = await runTwoHops();
  }, FIXTURE_TIMEOUT_MS);

  it("continues an inbound trace through the proxied call", () => {
    const webClient = spans.find((span) => span.kind === CLIENT_KIND);
    const servers = spans.filter((span) => span.kind === SERVER_KIND);
    const apiServer = servers.find(
      (span) => span.parentSpanId === webClient?.spanId,
    );
    const webServer = servers.find((span) => span !== apiServer);

    expect(spans).toHaveLength(3);
    expect(apiServer).toBeDefined();
    const traceIds = new Set(spans.map((span) => span.traceId));
    expect(traceIds).toEqual(new Set([INBOUND_TRACE_ID]));
    expect(webServer?.parentSpanId).toBe(INBOUND_SPAN_ID);
    expect(webClient?.parentSpanId).toBe(webServer?.spanId);
    expect(apiServer?.parentSpanId).toBe(webClient?.spanId);
  });

  it("strips the query and leaves the probes out", () => {
    const paths = spans.map((span) => span.urlPath);
    expect(new Set(paths)).toEqual(new Set(["/api/auth/callback"]));
    const webClient = spans.find((span) => span.kind === CLIENT_KIND);
    expect(webClient?.urlFull).toMatch(/\/api\/auth\/callback$/);
  });
});
