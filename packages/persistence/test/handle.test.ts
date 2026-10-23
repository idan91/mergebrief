// What `createDb` asks of node-postgres: the pool size the composition root
// passes and a bounded checkout wait. `pg` is mocked, so no database is opened.
import { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db/handle";

vi.mock("pg", () => ({
  Pool: vi.fn(function stubPool() {
    return { on: vi.fn() };
  }),
}));

const DSN = "postgres://app@127.0.0.1:5432/app";
const CHECKOUT_TIMEOUT_MS = 10_000;

beforeEach(() => {
  vi.mocked(Pool).mockClear();
});

describe("createDb pool options", () => {
  it("sizes the pool and bounds the checkout wait", () => {
    createDb(DSN, { maxConnections: 4 });

    expect(vi.mocked(Pool).mock.calls[0]?.[0]).toEqual({
      connectionString: DSN,
      max: 4,
      connectionTimeoutMillis: CHECKOUT_TIMEOUT_MS,
    });
  });

  it("leaves the pool size to node-postgres when none is given", () => {
    createDb(DSN);

    expect(vi.mocked(Pool).mock.calls[0]?.[0]).toMatchObject({
      max: undefined,
      connectionTimeoutMillis: CHECKOUT_TIMEOUT_MS,
    });
  });
});
