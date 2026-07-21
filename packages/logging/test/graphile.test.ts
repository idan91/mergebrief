import { describe, expect, it } from "vitest";
import { createGraphileLogFactory } from "../src/graphile";
import { createLogger } from "../src/logger";
import { captureDestination } from "./helpers";

function setup(env: NodeJS.ProcessEnv = {}) {
  const destination = captureDestination();
  const logger = createLogger({ env, destination });
  return { destination, factory: createGraphileLogFactory(logger) };
}

describe("createGraphileLogFactory", () => {
  it("carries the graphile scope as child bindings", () => {
    const { destination, factory } = setup();
    const logFn = factory({ workerId: "worker-1", taskIdentifier: "generate" });
    logFn("info", "job starting");
    const line = destination.lines()[0];
    expect(line?.["workerId"]).toBe("worker-1");
    expect(line?.["taskIdentifier"]).toBe("generate");
    expect(line?.["msg"]).toBe("job starting");
    expect(line?.["level"]).toBe("info");
  });

  it("maps graphile's warning level to warn", () => {
    const { destination, factory } = setup();
    factory({})("warning", "deprecated thing");
    expect(destination.lines()[0]?.["level"]).toBe("warn");
  });

  it("maps error and debug through, respecting level filtering", () => {
    const { destination, factory } = setup();
    const logFn = factory({});
    logFn("error", "bad");
    logFn("debug", "suppressed at info level");
    const lines = destination.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["level"]).toBe("error");
  });

  it("passes graphile meta through as fields", () => {
    const { destination, factory } = setup();
    factory({})("info", "with meta", { jobId: "42" });
    expect(destination.lines()[0]?.["jobId"]).toBe("42");
  });

  it("logs an unrecognized level as info rather than dropping it", () => {
    const { destination, factory } = setup();
    factory({})("bizarre", "unknown level");
    const lines = destination.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]?.["level"]).toBe("info");
  });
});
