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
        authorization: "Bearer secret-token",
        cookie: "session=abc",
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

const LEAKY_URL = "postgres://user:hunter2@db.internal:5432/app";

function serializedErr(destination: ReturnType<typeof captureDestination>): {
  [key: string]: unknown;
} {
  const err = destination.lines()[0]?.["err"];
  if (typeof err !== "object" || err === null || Array.isArray(err)) {
    throw new Error("expected a serialized err object on the line");
  }
  return { ...err };
}

describe("createLogger URL scrubbing — err serializer", () => {
  it("redacts a URL-shaped substring in err.message", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", { err: new Error(`connect failed for ${LEAKY_URL}`) });
    const err = serializedErr(destination);
    expect(err["message"]).toBe("connect failed for [redacted-url]");
    expect(destination.raw()[0]).not.toContain("hunter2");
  });

  it("redacts the stack's quoted message but keeps ESM file:// frames", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const err = new Error(`refused: ${LEAKY_URL}`);
    // Deterministic ESM-style stack: Node renders frames as file:// URLs.
    err.stack = `Error: refused: ${LEAKY_URL}\n    at boot (file:///app/packages/worker/src/main.ts:10:5)`;
    log.error("boom", { err });
    const serialized = serializedErr(destination);
    const stack = serialized["stack"];
    if (typeof stack !== "string") {
      throw new Error("expected a stack string");
    }
    expect(stack).toContain("[redacted-url]");
    expect(stack).toContain(
      "at boot (file:///app/packages/worker/src/main.ts:10:5)",
    );
    expect(stack).not.toContain("hunter2");
  });

  it("redacts URLs riding a cause chain (folded into message/stack)", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const cause = new Error(`migrate failed against ${LEAKY_URL}`);
    log.error("boom", { err: new Error("boot failed", { cause }) });
    expect(destination.raw()[0]).not.toContain("hunter2");
    expect(destination.raw()[0]).toContain("[redacted-url]");
  });

  it("redacts URLs in copied enumerable props (pg-style detail)", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const err = new Error("password authentication failed");
    Object.assign(err, { detail: `tried ${LEAKY_URL}` });
    log.error("boom", { err });
    const serialized = serializedErr(destination);
    expect(serialized["detail"]).toBe("tried [redacted-url]");
  });

  it("redacts URLs inside nested object props (octokit-style request)", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const err = new Error("Not Found");
    Object.assign(err, {
      request: { method: "GET", url: "https://api.github.com/repos/x/y" },
    });
    log.error("boom", { err });
    const serialized = serializedErr(destination);
    expect(serialized["request"]).toEqual({
      method: "GET",
      url: "[redacted-url]",
    });
  });

  it("redacts URLs in aggregate errors", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const aggregate = new AggregateError(
      [new Error(`member leak ${LEAKY_URL}`)],
      "several failures",
    );
    log.error("boom", { err: aggregate });
    expect(destination.raw()[0]).not.toContain("hunter2");
    expect(destination.raw()[0]).toContain("[redacted-url]");
  });

  it("survives a circular reference without throwing", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const err = new Error(`loop ${LEAKY_URL}`);
    const context: { [key: string]: unknown } = { url: LEAKY_URL };
    context["self"] = context;
    Object.assign(err, { context });
    log.error("boom", { err });
    const raw = destination.raw()[0];
    expect(raw).toBeDefined();
    expect(raw).not.toContain("hunter2");
  });

  it("scrubs a non-Error err value (thrown string)", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", { err: `connect ${LEAKY_URL} refused` });
    const line = destination.lines()[0];
    expect(line?.["err"]).toBe("connect [redacted-url] refused");
  });

  it("folds a duck-typed error-like's cause chain, scrubbed", () => {
    // Must route through pino's serializer like a real Error, or the cause's
    // non-enumerable message/stack vanish in the deep copy.
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", {
      err: {
        message: "wrapper failed",
        cause: new Error(`inner ${LEAKY_URL} down`),
      },
    });
    const err = serializedErr(destination);
    expect(err["message"]).toBe("wrapper failed: inner [redacted-url] down");
    expect(destination.raw()[0]).not.toContain("hunter2");
  });

  it("survives a frozen error-like without throwing, still scrubbed", () => {
    // pino's serializer tags its input with a symbol; that write throws on a
    // frozen object, and pino runs serializers uncaught.
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", {
      err: Object.freeze({ message: `frozen ${LEAKY_URL}` }),
    });
    const line = destination.raw()[0];
    expect(line).toBeDefined();
    expect(line).not.toContain("hunter2");
    expect(line).toContain("[redacted-url]");
  });

  it("does not mutate the caller's non-Error err object", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const original = { message: `raw ${LEAKY_URL}` };
    log.error("boom", { err: original });
    expect(original.message).toBe(`raw ${LEAKY_URL}`);
    expect(destination.raw()[0]).not.toContain("hunter2");
  });

  it("also serializes and scrubs the error key", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", { error: new Error(`via error key ${LEAKY_URL}`) });
    const line = destination.lines()[0];
    expect(line?.["error"]).toMatchObject({
      message: "via error key [redacted-url]",
    });
    expect(line?.["error"]).toHaveProperty("stack");
    expect(destination.raw()[0]).not.toContain("hunter2");
  });

  it("leaves a URL-free error byte-identical", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", { err: new Error("plain failure, no secrets") });
    const err = serializedErr(destination);
    expect(err["message"]).toBe("plain failure, no secrets");
  });
});

describe("createLogger credential scrubbing", () => {
  // Real shapes: a provider's own error prose carries the key it rejected,
  // and key-path redaction cannot see inside a sentence.
  const CASES: ReadonlyArray<readonly [string, string]> = [
    ["anthropic", "sk-ant-api03-AbCdEf_ghij-klmn"],
    ["openai", "sk-proj-AbCdEfGhIjKlMnOpQrSt"],
    ["github pat", "ghp_AbCdEfGhIjKlMnOpQrStUvWx0123"],
    ["github fine-grained", "github_pat_11ABCDEFG0abcdefghij_KLMNOP"],
    ["slack", "xoxb-1234567890-abcdefghij"],
    ["mergebrief api token", "mergebrief_AbCdEfGhIjKlMnOpQr"],
    ["aws access key", "AKIAIOSFODNN7EXAMPLE"],
  ];

  it.each(CASES)("redacts a %s token interpolated into msg", (_name, token) => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error(`generation failed — invalid key ${token} for the request`);
    const raw = destination.raw()[0] ?? "";
    expect(raw).not.toContain(token);
    expect(destination.lines()[0]?.["msg"]).toContain("[redacted-token]");
  });

  it("redacts a token riding a serialized error message", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.error("boom", {
      err: new Error("401 invalid x-api-key sk-ant-api03-LeAkEd_Key-999"),
    });
    const raw = destination.raw()[0] ?? "";
    expect(raw).not.toContain("sk-ant-api03-LeAkEd_Key-999");
    expect(raw).toContain("[redacted-token]");
  });

  it("leaves ordinary prose untouched — prefixes, not entropy", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    const msg =
      "generate: succeeded for 1234abcd — sk is fine, so is ghost_writer and AKIA";
    log.info(msg);
    expect(destination.lines()[0]?.["msg"]).toBe(msg);
  });
});

describe("createLogger URL scrubbing — msg", () => {
  it("redacts a URL-shaped substring interpolated into msg", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.warn(`pool error — connect failed for ${LEAKY_URL}`);
    const line = destination.lines()[0];
    expect(line?.["msg"]).toBe(
      "pool error — connect failed for [redacted-url]",
    );
    expect(destination.raw()[0]).not.toContain("hunter2");
  });

  it("leaves a URL-free msg untouched", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.info("generate: succeeded for 1234abcd");
    expect(destination.lines()[0]?.["msg"]).toBe(
      "generate: succeeded for 1234abcd",
    );
  });

  it("scrubs msg on child loggers too", () => {
    const destination = captureDestination();
    const log = createLogger({ env: {}, destination });
    log.child({ prId: "pr-1" }).error(`boot: ${LEAKY_URL} unreachable`);
    expect(destination.lines()[0]?.["msg"]).toBe(
      "boot: [redacted-url] unreachable",
    );
  });
});
