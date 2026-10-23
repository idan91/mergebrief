// graphile opens its own pool from the connection string, so the runner must
// size it from the same knob as the persistence pool. graphile and the schema
// check are mocked: what is pinned is the options the runner hands graphile.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as graphileModule from "graphile-worker";
import type * as persistenceModule from "persistence";
import { run } from "graphile-worker";
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

describe("startWorker", () => {
  it("sizes graphile's pool from the pool max it is given", async () => {
    await startWorker({
      databaseUrl: "postgres://worker@127.0.0.1:5432/app",
      taskList: { generate: () => Promise.resolve() },
      crontab: "",
      poolMax: POOL_MAX,
    });

    expect(vi.mocked(run).mock.calls[0]?.[0]).toMatchObject({
      maxPoolSize: POOL_MAX,
    });
  });
});
