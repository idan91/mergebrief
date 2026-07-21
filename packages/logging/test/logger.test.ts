import { describe, expect, it } from "vitest";
import { createLogger, resolveLoggerConfig } from "../src/logger";
import { captureDestination } from "./helpers";

describe("resolveLoggerConfig", () => {
  it("defaults to level info, JSON format", () => {
    expect(resolveLoggerConfig({})).toEqual({ level: "info", pretty: false });
  });

  it("reads LOG_LEVEL", () => {
    expect(resolveLoggerConfig({ LOG_LEVEL: "debug" }).level).toBe("debug");
    expect(resolveLoggerConfig({ LOG_LEVEL: "error" }).level).toBe("error");
  });

  it("selects pretty only when NODE_ENV=development", () => {
    expect(resolveLoggerConfig({ NODE_ENV: "development" }).pretty).toBe(true);
    expect(resolveLoggerConfig({ NODE_ENV: "production" }).pretty).toBe(false);
    expect(resolveLoggerConfig({ NODE_ENV: "test" }).pretty).toBe(false);
    expect(resolveLoggerConfig({}).pretty).toBe(false);
  });

  it("treats a blank LOG_LEVEL as unset, not an error", () => {
    expect(resolveLoggerConfig({ LOG_LEVEL: "" }).level).toBe("info");
  });

  it("throws on an unknown LOG_LEVEL, naming the allowed values", () => {
    expect(() => resolveLoggerConfig({ LOG_LEVEL: "verbose" })).toThrow(
      /error, warn, info, debug/,
    );
  });
});

describe("createLogger level filtering", () => {
  it("suppresses debug at the default info level", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.debug("hidden");
    log.info("shown");
    const lines = destination.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["msg"]).toBe("shown");
  });

  it("emits debug when LOG_LEVEL=debug", () => {
    const destination = captureDestination();
    const log = createLogger({ env: { LOG_LEVEL: "debug" }, destination });
    log.debug("now visible");
    expect(destination.lines()).toHaveLength(1);
  });

  it("suppresses warn and below when LOG_LEVEL=error", () => {
    const destination = captureDestination();
    const log = createLogger({ env: { LOG_LEVEL: "error" }, destination });
    log.warn("hidden");
    log.info("hidden");
    log.error("shown");
    const lines = destination.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["msg"]).toBe("shown");
  });

  it("renders the level as a string label, not a number", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.warn("labelled");
    expect(destination.lines()[0]?.["level"]).toBe("warn");
  });
});

describe("createLogger fields and children", () => {
  it("spreads fields as top-level properties alongside msg", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.info("with fields", { evt: "api.access", status: 200 });
    const line = destination.lines()[0];
    expect(line?.["evt"]).toBe("api.access");
    expect(line?.["status"]).toBe(200);
    expect(line?.["msg"]).toBe("with fields");
  });

  it("child bindings ride every line the child emits", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const job = log.child({ prId: "pr-1", headSha: "abc123" });
    job.info("picked up");
    job.error("failed", { attempt: 2 });
    const lines = destination.lines();
    expect(lines[0]?.["prId"]).toBe("pr-1");
    expect(lines[1]?.["prId"]).toBe("pr-1");
    expect(lines[1]?.["headSha"]).toBe("abc123");
    expect(lines[1]?.["attempt"]).toBe(2);
  });

  it("children of children merge bindings", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const inner = log.child({ a: 1 }).child({ b: 2 });
    inner.info("nested");
    const line = destination.lines()[0];
    expect(line?.["a"]).toBe(1);
    expect(line?.["b"]).toBe(2);
  });
});

describe("createLogger redaction", () => {
  it("removes top-level secret keys entirely — no placeholder", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.info("token exchange", { token: "ghs_abc", status: 200 });
    const line = destination.lines()[0];
    expect(line).not.toHaveProperty("token");
    expect(destination.raw()[0]).not.toContain("ghs_abc");
    expect(destination.raw()[0]).not.toContain("Redacted");
    expect(line?.["status"]).toBe(200);
  });

  it("removes secret keys one level deep", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.info("nested secret", {
      github: { accessToken: "gho_xyz", login: "octocat" },
    });
    const line = destination.lines()[0];
    const github = line?.["github"];
    expect(github).toEqual({ login: "octocat" });
    expect(destination.raw()[0]).not.toContain("gho_xyz");
  });

  it("removes sensitive request headers", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.info("request", {
      headers: {
        "authorization": "Bearer secret-token",
        "cookie": "session=abc",
        "x-hub-signature-256": "sha256=deadbeef",
        "user-agent": "curl/8",
      },
    });
    const raw = destination.raw()[0];
    expect(raw).not.toContain("secret-token");
    expect(raw).not.toContain("session=abc");
    expect(raw).not.toContain("deadbeef");
    expect(raw).toContain("curl/8");
  });

  it("removes the full secret-key vocabulary at top level", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.info("all secrets", {
      accessToken: "a",
      refreshToken: "b",
      secret: "c",
      webhookSecret: "d",
      privateKey: "e",
      clientSecret: "f",
      connectionString: "g",
      databaseUrl: "h",
      kept: "visible",
    });
    const line = destination.lines()[0];
    expect(line?.["kept"]).toBe("visible");
    for (const key of [
      "accessToken",
      "refreshToken",
      "secret",
      "webhookSecret",
      "privateKey",
      "clientSecret",
      "connectionString",
      "databaseUrl",
    ]) {
      expect(line).not.toHaveProperty(key);
    }
  });

  it("redacts secrets carried in child bindings", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const child = log.child({ token: "ghs_bound", prId: "pr-9" });
    child.info("bound secret");
    const line = destination.lines()[0];
    expect(line).not.toHaveProperty("token");
    expect(line?.["prId"]).toBe("pr-9");
  });
});

describe("createLogger error serialization", () => {
  it("serializes an err field with type, message, and stack", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", { err: new Error("kaput") });
    const line = destination.lines()[0];
    const err = line?.["err"];
    expect(err).toMatchObject({ type: "Error", message: "kaput" });
    expect(err).toHaveProperty("stack");
  });
});
