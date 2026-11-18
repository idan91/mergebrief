import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeNeverAbortingSignal } from "../../../../../../test/signals";
import { createResizeTurns } from "./resize-turns";

const LIMIT = 4;
const MAX_WAIT_MS = 10_000;
const MAX_WAITING = 64;

describe("createResizeTurns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grants four turns at once without waiting", async () => {
    const turns = createResizeTurns(LIMIT, MAX_WAIT_MS, MAX_WAITING);

    const granted = await Promise.all(
      Array.from({ length: LIMIT }, () =>
        turns.waitForTurn(makeNeverAbortingSignal()),
      ),
    );

    expect(granted.every((turn) => turn !== undefined)).toBe(true);
    expect(turns.countRunning()).toBe(LIMIT);
  });

  it("makes a fifth request wait until a running turn ends", async () => {
    const turns = createResizeTurns(LIMIT, MAX_WAIT_MS, MAX_WAITING);
    const running = await Promise.all(
      Array.from({ length: LIMIT }, () =>
        turns.waitForTurn(makeNeverAbortingSignal()),
      ),
    );
    let fifthSettled = false;

    const fifth = turns.waitForTurn(makeNeverAbortingSignal()).then((turn) => {
      fifthSettled = true;
      return turn;
    });
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS - 1);
    expect(fifthSettled).toBe(false);
    running[0]?.release();

    expect(await fifth).toBeDefined();
    expect(turns.countRunning()).toBe(LIMIT);
  });

  it("gives up on a waiting request after ten seconds", async () => {
    const turns = createResizeTurns(LIMIT, MAX_WAIT_MS, MAX_WAITING);
    await Promise.all(
      Array.from({ length: LIMIT }, () =>
        turns.waitForTurn(makeNeverAbortingSignal()),
      ),
    );

    const fifth = turns.waitForTurn(makeNeverAbortingSignal());
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);

    expect(await fifth).toBeUndefined();
    expect(turns.countRunning()).toBe(LIMIT);
  });

  it("hands a freed turn to the oldest waiter only", async () => {
    const turns = createResizeTurns(1, MAX_WAIT_MS, MAX_WAITING);
    const first = await turns.waitForTurn(makeNeverAbortingSignal());
    const order: string[] = [];

    const second = turns.waitForTurn(makeNeverAbortingSignal()).then((turn) => {
      order.push("second");
      return turn;
    });
    void turns
      .waitForTurn(makeNeverAbortingSignal())
      .then(() => order.push("third"));
    first?.release();
    await second;
    await vi.advanceTimersByTimeAsync(0);

    expect(order).toEqual(["second"]);
  });

  it("stops waiting when the request is aborted", async () => {
    const turns = createResizeTurns(1, MAX_WAIT_MS, MAX_WAITING);
    const first = await turns.waitForTurn(makeNeverAbortingSignal());
    const controller = new AbortController();

    const waiting = turns.waitForTurn(controller.signal);
    controller.abort();
    first?.release();

    expect(await waiting).toBeUndefined();
    expect(turns.countRunning()).toBe(0);
  });

  it("grants nothing to a request already aborted", async () => {
    const turns = createResizeTurns(LIMIT, MAX_WAIT_MS, MAX_WAITING);

    const turn = await turns.waitForTurn(AbortSignal.abort());

    expect(turn).toBeUndefined();
    expect(turns.countRunning()).toBe(0);
  });

  it("frees a turn once however often it is released", async () => {
    const turns = createResizeTurns(2, MAX_WAIT_MS, MAX_WAITING);
    const first = await turns.waitForTurn(makeNeverAbortingSignal());
    await turns.waitForTurn(makeNeverAbortingSignal());

    first?.release();
    first?.release();

    expect(turns.countRunning()).toBe(1);
  });

  it("refuses at once a request past the waiting limit", async () => {
    const turns = createResizeTurns(1, MAX_WAIT_MS, 2);
    await turns.waitForTurn(makeNeverAbortingSignal());
    const waiters = [
      turns.waitForTurn(makeNeverAbortingSignal()),
      turns.waitForTurn(makeNeverAbortingSignal()),
    ];

    const refused = await turns.waitForTurn(makeNeverAbortingSignal());

    expect(refused).toBeUndefined();
    expect(turns.countWaiting()).toBe(2);
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS);
    expect(await Promise.all(waiters)).toEqual([undefined, undefined]);
  });
});
