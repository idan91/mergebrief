// The request-logging middleware: request-id
// accept/mint/echo + the ONE api.access line per request, assembled from
// whatever the authz layers stamped into context.
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { createLogger, type Logger } from "logging";
import { startTestTracing, type TestTracing } from "logging/testing";
import { describe, expect, it } from "vitest";
import {
  requestLogging,
  stampAccess,
  type RequestLogEnv,
} from "../src/request-logging";

interface CapturedLine {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is CapturedLine {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureLogger(env: Record<string, string> = {}): {
  logger: Logger;
  lines: () => CapturedLine[];
} {
  const written: string[] = [];
  const logger = createLogger({
    env,
    destination: { write: (line: string) => void written.push(line) },
  });
  return {
    logger,
    lines: () =>
      written.map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) {
          throw new Error(`expected NDJSON object: ${line}`);
        }
        return parsed;
      }),
  };
}

function buildApp(logger: Logger): Hono<RequestLogEnv> {
  const app = new Hono<RequestLogEnv>();
  app.use(requestId());
  app.use(requestLogging(logger));
  app.get("/api/ok", (c) => c.json({ ok: true }));
  app.get("/api/logs", (c) => {
    c.get("logger").info("from the handler", { detail: 7 });
    return c.json({ ok: true });
  });
  app.get("/api/stamped", (c) => {
    stampAccess(c, "404", { reviewerId: 42n });
    return c.json({ error: "not found" }, 404);
  });
  app.get("/api/version", (c) => c.json({ version: "1.4.0" }));
  app.get("/api/repos/:repoId/brief", (context) => context.json({ ok: true }));
  return app;
}

describe("requestLogging", () => {
  it("logs a successful polled version read at debug, a failure at info", async () => {
    const { logger, lines } = captureLogger({ LOG_LEVEL: "debug" });
    const app = buildApp(logger);

    await app.request("/api/version");
    await app.request("/api/version", { method: "POST" });

    const access = lines().filter((line) => line["evt"] === "api.access");
    expect(
      access.map((line) => [line["path"], line["level"], line["status"]]),
    ).toEqual([
      ["/api/version", "debug", 200],
      ["/api/version", "info", 404],
    ]);
  });

  it("emits one api.access line with the access fields + reqId", async () => {
    const { logger, lines } = captureLogger();
    const res = await buildApp(logger).request("/api/ok");
    expect(res.status).toBe(200);
    const access = lines().filter((l) => l["evt"] === "api.access");
    expect(access).toHaveLength(1);
    const line = access[0];
    expect(line?.["method"]).toBe("GET");
    expect(line?.["path"]).toBe("/api/ok");
    expect(line?.["status"]).toBe(200);
    expect(line?.["decision"]).toBe("200");
    expect(typeof line?.["durationMs"]).toBe("number");
    expect(typeof line?.["reqId"]).toBe("string");
  });

  it("echoes a valid inbound X-Request-Id and logs it", async () => {
    const { logger, lines } = captureLogger();
    const res = await buildApp(logger).request("/api/ok", {
      headers: { "x-request-id": "operator-abc-123" },
    });
    expect(res.headers.get("x-request-id")).toBe("operator-abc-123");
    expect(lines()[0]?.["reqId"]).toBe("operator-abc-123");
  });

  it("hands routes a child logger bound to the request id", async () => {
    const { logger, lines } = captureLogger();
    await buildApp(logger).request("/api/logs", {
      headers: { "x-request-id": "bound-id-1" },
    });
    const handlerLine = lines().find((l) => l["msg"] === "from the handler");
    expect(handlerLine?.["reqId"]).toBe("bound-id-1");
    expect(handlerLine?.["detail"]).toBe(7);
  });

  it("still emits the access line when the handler throws", async () => {
    const { logger, lines } = captureLogger();
    const app = buildApp(logger);
    app.get("/api/boom", () => {
      throw new Error("handler exploded");
    });
    const res = await app.request("/api/boom");
    expect(res.status).toBe(500);
    const line = lines().find((l) => l["evt"] === "api.access");
    expect(line?.["status"]).toBe(500);
    expect(line?.["decision"]).toBe("500");
  });

  it("prefers a stamped gate decision over the response status", async () => {
    const { logger, lines } = captureLogger();
    await buildApp(logger).request("/api/stamped");
    const line = lines().find((l) => l["evt"] === "api.access");
    expect(line?.["status"]).toBe(404);
    expect(line?.["decision"]).toBe("404");
    expect(line?.["reviewerId"]).toBe("42");
  });
});

describe("request span naming", () => {
  it("names the request's span for the matched route pattern", async () => {
    const tracing = startTestTracing();
    const app = buildApp(captureLogger().logger);

    let spans: ReturnType<TestTracing["readFinishedSpans"]> = [];
    try {
      await tracing.runInSpan(async () => {
        await app.request("/api/repos/42/brief");
      });
      spans = tracing.readFinishedSpans();
    } finally {
      await tracing.stop();
    }
    const [request] = spans;
    expect(request?.name).toBe("GET /api/repos/:repoId/brief");
    expect(request?.attributes["http.route"]).toBe("/api/repos/:repoId/brief");
  });
});
