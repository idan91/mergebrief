import { describe, expect, it } from "vitest";
import { createGraphileLogFactory } from "../src/graphile";
import { createLogger } from "../src/logger";
import {
  captureDestination,
  DRIVER_MESSAGE,
  QUERY_PARAM,
  QUERY_SQL,
  StubQueryError,
} from "./helpers";

const FAILED_JOB = {
  id: "7",
  task_identifier: "generate",
  attempts: 1,
  max_attempts: 3,
};

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

  it("cuts a finished job's row to four columns on any line", () => {
    const { destination, factory } = setup();
    const job = {
      id: "7",
      task_identifier: "generate",
      attempts: 2,
      max_attempts: 3,
      payload: { pull_request_id: "9" },
      last_error: `Failed query: ${QUERY_SQL}\nparams: ${QUERY_PARAM}`,
    };

    factory({})("info", "Completed task 7 (generate) with success", {
      job,
      duration: 12,
      success: true,
    });

    const line = destination.lines()[0];
    expect(line?.["job"]).toEqual({
      id: "7",
      task_identifier: "generate",
      attempts: 2,
      max_attempts: 3,
    });
    expect(JSON.stringify(line)).not.toContain(QUERY_PARAM);
    expect(line?.["success"]).toBe(true);
  });

  it("cuts every job row a shutdown line lists, and its other errors", () => {
    const { destination, factory } = setup({ LOG_LEVEL: "debug" });
    const row = {
      id: "7",
      task_identifier: "generate",
      attempts: 2,
      max_attempts: 3,
      last_error: `Failed query: ${QUERY_SQL}\nparams: ${QUERY_PARAM}`,
    };
    const reason = new Error(`shutdown\nparams: ${QUERY_PARAM}`);

    factory({})("debug", "Releasing the jobs", {
      jobs: [row],
      cancelledJobs: [row],
      reason,
    });

    const line = destination.lines()[0];
    const kept = {
      id: "7",
      task_identifier: "generate",
      attempts: 2,
      max_attempts: 3,
    };
    expect(line?.["jobs"]).toEqual([kept]);
    expect(line?.["cancelledJobs"]).toEqual([kept]);
    expect(line?.["reason"]).toBe("shutdown");
    expect(JSON.stringify(line)).not.toContain(QUERY_PARAM);
  });

  it("logs a failed job by its message lines, without the error or params", () => {
    const { destination, factory } = setup();
    const error = new StubQueryError(new Error(DRIVER_MESSAGE));
    const job = {
      id: "7",
      task_identifier: "generate",
      attempts: 1,
      max_attempts: 3,
      payload: { prId: "pr-9" },
      last_error: error.message,
    };
    // The line graphile-worker writes for a task that threw.
    const written = `Failed task 7 (generate, 12.00ms, attempt 1 of 3) with error '${error.message}':\n  ${error.stack}`;
    factory({})("error", written, { failure: true, job, error, duration: 12 });

    const line = destination.lines()[0];
    expect(destination.raw()[0]).not.toContain(QUERY_PARAM);
    expect(line?.["msg"]).toBe(
      `Failed task 7 (generate, attempt 1 of 3): Failed query: ${QUERY_SQL}: ${DRIVER_MESSAGE}`,
    );
    expect(line?.["job"]).toEqual({
      id: "7",
      task_identifier: "generate",
      attempts: 1,
      max_attempts: 3,
    });
    expect(line?.["duration"]).toBe(12);
    expect(line).not.toHaveProperty("error");
  });
  it("ends on a cause chain that loops back on itself", () => {
    const { destination, factory } = setup();
    const error = new Error("sweep failed");
    error.cause = error;

    factory({})("error", "Failed task", {
      failure: true,
      job: FAILED_JOB,
      error,
    });

    expect(destination.lines()[0]?.["msg"]).toBe(
      "Failed task 7 (generate, attempt 1 of 3): sweep failed",
    );
  });

  it("names each cause of a failed job once, three deep at most", () => {
    const { destination, factory } = setup();
    const fifth = new Error("fifth");
    const fourth = new Error("fourth", { cause: fifth });
    const third = new Error("third\nits second line", { cause: fourth });
    const repeated = new Error("store write failed: third", { cause: third });
    const error = new Error("sweep failed", { cause: repeated });

    factory({})("error", "Failed task", {
      failure: true,
      job: FAILED_JOB,
      error,
    });

    expect(destination.lines()[0]?.["msg"]).toBe(
      "Failed task 7 (generate, attempt 1 of 3): sweep failed: store write failed: third: fourth",
    );
  });

  it("logs a failed job that threw no error object", () => {
    const { destination, factory } = setup();

    factory({})("error", "Failed task", {
      failure: true,
      job: FAILED_JOB,
      error: "plain reason",
    });

    expect(destination.lines()[0]?.["msg"]).toBe(
      "Failed task 7 (generate, attempt 1 of 3): plain reason",
    );
  });
});
