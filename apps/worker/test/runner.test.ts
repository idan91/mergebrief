// graphile opens its own pool from the connection string, so the runner must
// size it from the same knob as the persistence pool. graphile and the schema
// check are mocked: what is pinned is the options the runner hands graphile.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as graphileModule from "graphile-worker";
import type * as persistenceModule from "persistence";
import { run, type Runner } from "graphile-worker";
import { startWorker } from "../src/runner";

vi.mock("graphile-worker", async (importOriginal) => ({
  ...(await importOriginal<typeof graphileModule>()),
  run: vi.fn(),
  runMigrations: vi.fn(async () => undefined),
}));

vi.mock("persistence", async (importOriginal) => ({
  ...(await importOriginal<typeof persistenceModule>()),
  ensureAppSchema: vi.fn(async () => ({ ok: true, value: undefined })),
}));

const POOL_MAX = 4;

beforeEach(() => {
  vi.mocked(run).mockReset();
});

const DATABASE_URL = "postgres://worker@127.0.0.1:5432/app";
const LARGE_SLOTS = 2;

function stubRunner(): Runner {
  const runner: Pick<Runner, "promise" | "stop"> = {
    promise: Promise.resolve(),
    stop: vi.fn(async () => undefined),
  };
  return runner as Runner;
}

describe("startWorker", () => {
  it("sizes graphile's pool from the pool max it is given", async () => {
    vi.mocked(run).mockResolvedValue(stubRunner());

    await startWorker({
      databaseUrl: DATABASE_URL,
      taskList: { generate: () => Promise.resolve() },
      crontab: "",
      poolMax: POOL_MAX,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.mocked(run).mock.calls[0]?.[0]).toMatchObject({
      maxPoolSize: POOL_MAX,
    });
  });

  it("starts the large pool as a second runner without the crontab", async () => {
    vi.mocked(run).mockResolvedValue(stubRunner());
    const largeTaskList = { "generate-large": () => Promise.resolve() };

    await startWorker({
      databaseUrl: DATABASE_URL,
      taskList: { generate: () => Promise.resolve() },
      crontab: "",
      poolMax: POOL_MAX,
      largePool: { taskList: largeTaskList, concurrency: LARGE_SLOTS },
    });

    expect(run).toHaveBeenCalledTimes(2);
    const large = vi.mocked(run).mock.calls[1]?.[0];
    expect(large).toMatchObject({
      connectionString: DATABASE_URL,
      concurrency: LARGE_SLOTS,
      taskList: largeTaskList,
      maxPoolSize: LARGE_SLOTS + 2,
      noHandleSignals: true,
    });
    expect(large).not.toHaveProperty("crontab");
  });

  it("stops both runners together", async () => {
    const first = stubRunner();
    const large = stubRunner();
    vi.mocked(run).mockResolvedValueOnce(first).mockResolvedValueOnce(large);

    const worker = await startWorker({
      databaseUrl: DATABASE_URL,
      taskList: { generate: () => Promise.resolve() },
      crontab: "",
      largePool: {
        taskList: { "generate-large": () => Promise.resolve() },
        concurrency: 1,
      },
    });
    await worker.stop();
    await worker.promise;

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(large.stop).toHaveBeenCalledTimes(1);
  });

  it("stops the first runner when the large pool fails to start", async () => {
    const first = stubRunner();
    const bootFailure = new Error("too many clients");
    vi.mocked(run)
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(bootFailure);

    const started = startWorker({
      databaseUrl: DATABASE_URL,
      taskList: { generate: () => Promise.resolve() },
      crontab: "",
      largePool: {
        taskList: { "generate-large": () => Promise.resolve() },
        concurrency: 1,
      },
    });

    await expect(started).rejects.toBe(bootFailure);
    expect(first.stop).toHaveBeenCalledTimes(1);
  });
});
