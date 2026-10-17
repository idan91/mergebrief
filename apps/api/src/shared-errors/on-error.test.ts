import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "logging";
import { ScopeViolationError } from "persistence";
import type { RequestLogEnv } from "../request-logging";
import { NotFound } from "./api-error";
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
    throw new NotFound();
  });
  app.get("/boom", () => {
    throw new Error("secret internals");
  });
  app.get("/scope", () => {
    throw new ScopeViolationError("pull_request", 42n, "tenant 7");
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

  it("renders a ScopeViolationError as the plain not-found, unlogged", async () => {
    const { app, errorSpy } = buildApp();
    const res = await app.request("/scope");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("renders a non-ApiError throw as a sanitized 500, internals logged", async () => {
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
  it("sees next resolve with the rendered response and the code stamp", async () => {
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

  it("stamps a scope violation with the not-found code", async () => {
    const { app } = buildApp();
    let observedCode: string | undefined;
    const probe = new Hono<RequestLogEnv>();
    probe.use(async (c, next) => {
      await next();
      observedCode = c.get("apiErrorCode");
    });
    probe.route("/", app);
    const res = await probe.request("/scope");
    expect(res.status).toBe(404);
    expect(observedCode).toBe("not-found");
  });
});
