import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "logging";
import { ApiErrorCode } from "../error-response";
import type { RequestLogEnv } from "../request-logging";
import { NotFound, ServiceUnavailable } from "./api-error";
import { createErrorHandler } from "./on-error";

function buildApp(): {
  app: Hono<RequestLogEnv>;
  errorSpy: ReturnType<typeof vi.fn>;
} {
  const errorSpy = vi.fn();
  const logger: Logger = {
    error: errorSpy,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  const app = new Hono<RequestLogEnv>();
  app.use(async (c, next) => {
    c.set("logger", logger);
    await next();
  });
  app.onError(createErrorHandler(logger));
  app.get("/api-error", () => {
    throw new NotFound(ApiErrorCode.NOT_FOUND);
  });
  app.get("/api-error-params", () => {
    throw new ServiceUnavailable(ApiErrorCode.GENERATION_CONFIG, {
      detail: "missing ANTHROPIC_API_KEY",
    });
  });
  app.get("/boom", () => {
    throw new Error("secret internals");
  });
  return { app, errorSpy };
}

describe("createErrorHandler", () => {
  it("renders a thrown ApiError as its wire body with status and no-store", async () => {
    const { app, errorSpy } = buildApp();
    const res = await app.request("/api-error");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("interpolates params into the English line and carries them", async () => {
    const { app } = buildApp();
    const res = await app.request("/api-error-params");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "missing ANTHROPIC_API_KEY",
      code: "generation-config",
      params: { detail: "missing ANTHROPIC_API_KEY" },
    });
  });

  it("renders a non-ApiError throw as a sanitized 500, internals to the log only", async () => {
    const { app, errorSpy } = buildApp();
    const res = await app.request("/boom");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: "internal error", code: "internal-error" });
    expect(JSON.stringify(body)).not.toContain("secret internals");
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("middleware above the throw", () => {
  it("sees next() resolve with the rendered response and the code stamp", async () => {
    const { app } = buildApp();
    let observedStatus: number | undefined;
    let observedCode: string | undefined;
    const probe = new Hono<RequestLogEnv>();
    probe.use(async (c, next) => {
      await next();
      observedStatus = c.res.status;
      observedCode = c.get("apiErrorCode");
    });
    probe.route("/", app);
    const res = await probe.request("/api-error");
    expect(res.status).toBe(404);
    expect(observedStatus).toBe(404);
    expect(observedCode).toBe("not-found");
  });
});
