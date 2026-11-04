// Asking GitHub to resend what the api could not take: which failed deliveries
// go, how far apart, and when a tick stops.
import { describe, expect, it } from "vitest";
import type { HookDelivery } from "github";
import { selectRedeliveries } from "../src/task/reconcile-webhook-deliveries/logic/select-redeliveries";
import {
  createReconcileWebhookDeliveriesTask,
  type ReconcileWebhookDeliveriesTaskDeps,
} from "../src/task/reconcile-webhook-deliveries";
import { captureLogger } from "./generate/helpers";

const NOW = new Date("2026-11-04T12:00:00Z");
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function makeDelivery(
  id: number,
  guid: string,
  statusCode: number,
  ageMs: number,
  overrides: Partial<HookDelivery> = {},
): HookDelivery {
  return {
    id: String(id),
    guid,
    statusCode,
    deliveredAt: new Date(NOW.getTime() - ageMs),
    event: "pull_request",
    redelivery: false,
    installationId: 100,
    ...overrides,
  };
}

/** A later attempt of the same delivery. */
function makeAttempt(
  id: number,
  guid: string,
  statusCode: number,
  ageMs: number,
): HookDelivery {
  return makeDelivery(id, guid, statusCode, ageMs, { redelivery: true });
}

function selectIds(deliveries: readonly HookDelivery[]): number[] {
  const selected = selectRedeliveries(deliveries, NOW);
  return selected.map((delivery) => Number(delivery.id));
}

describe("selectRedeliveries", () => {
  it("resends a failed delivery once its first wait has passed", () => {
    const deliveries = [makeDelivery(1, "a", 502, 20 * MINUTE_MS)];

    expect(selectIds(deliveries)).toEqual([1]);
  });

  it("waits out the first interval", () => {
    const deliveries = [makeDelivery(1, "a", 502, 5 * MINUTE_MS)];

    expect(selectIds(deliveries)).toEqual([]);
  });

  it("reads a connection failure as failed", () => {
    const deliveries = [makeDelivery(1, "a", 0, HOUR_MS)];

    expect(selectIds(deliveries)).toEqual([1]);
  });

  it("skips a delivery the api took", () => {
    const deliveries = [makeDelivery(1, "a", 200, HOUR_MS)];

    expect(selectIds(deliveries)).toEqual([]);
  });

  it("skips a guid with any success among its attempts", () => {
    expect(
      selectIds([
        makeAttempt(2, "a", 200, 20 * MINUTE_MS),
        makeDelivery(1, "a", 502, 2 * HOUR_MS),
      ]),
    ).toEqual([]);
  });

  it.each([400, 413])(
    "never resends a %i, which fails the same way",
    (status) => {
      const deliveries = [makeDelivery(1, "a", status, HOUR_MS)];

      expect(selectIds(deliveries)).toEqual([]);
    },
  );

  it("waits longer after each attempt, from the last attempt's time", () => {
    const secondAttempt = [
      makeAttempt(2, "a", 502, 30 * MINUTE_MS),
      makeDelivery(1, "a", 502, 2 * HOUR_MS),
    ];
    const secondAttemptLater = [
      makeAttempt(2, "a", 502, 90 * MINUTE_MS),
      makeDelivery(1, "a", 502, 3 * HOUR_MS),
    ];

    expect(selectIds(secondAttempt)).toEqual([]);
    expect(selectIds(secondAttemptLater)).toEqual([1]);
  });

  it("stops after five attempts", () => {
    const attempts = [5, 4, 3, 2, 1].map((id) =>
      makeDelivery(id, "a", 502, (6 - id) * 13 * HOUR_MS, {
        redelivery: id !== 1,
      }),
    );

    expect(selectIds(attempts)).toEqual([]);
  });

  it("leaves a delivery near GitHub's three-day limit", () => {
    const deliveries = [makeDelivery(1, "a", 502, 71.5 * HOUR_MS)];

    expect(selectIds(deliveries)).toEqual([]);
  });

  it("leaves a guid whose original fell out of view", () => {
    const deliveries = [makeAttempt(2, "a", 401, 20 * HOUR_MS)];

    expect(selectIds(deliveries)).toEqual([]);
  });

  it("never replays a revoked authorization, which has no confirmation", () => {
    const revoke = makeDelivery(1, "a", 502, HOUR_MS, {
      event: "github_app_authorization",
    });

    expect(selectIds([revoke])).toEqual([]);
  });

  it("resends installation events, which confirm with GitHub first", () => {
    const uninstall = makeDelivery(1, "a", 502, HOUR_MS, {
      event: "installation",
      action: "deleted",
    });

    expect(selectIds([uninstall])).toEqual([1]);
  });

  it.each([
    ["installation", "deleted"],
    ["installation_repositories", "removed"],
  ])("holds a push back once a later %s %s", (event, action) => {
    const push = makeDelivery(1, "a", 502, 2 * HOUR_MS);
    const removal = makeDelivery(2, "b", 200, HOUR_MS, { event, action });

    expect(selectIds([removal, push])).toEqual([]);
  });

  it("resends a push when the removal came first", () => {
    const removal = makeDelivery(2, "b", 200, 3 * HOUR_MS, {
      event: "installation_repositories",
      action: "removed",
    });
    const push = makeDelivery(1, "a", 502, HOUR_MS);

    expect(selectIds([removal, push])).toEqual([1]);
  });

  it("lets a removal's retry stay behind a push newer than the removal", () => {
    const removal = makeDelivery(1, "b", 502, 2 * HOUR_MS, {
      event: "installation_repositories",
      action: "removed",
    });
    const retry = makeDelivery(2, "b", 200, MINUTE_MS, {
      event: "installation_repositories",
      action: "removed",
      redelivery: true,
    });
    const push = makeDelivery(3, "a", 502, 20 * MINUTE_MS);

    expect(selectIds([retry, removal, push])).toEqual([3]);
  });

  it("holds a push behind a removal whose first attempt is out of view", () => {
    const retry = makeDelivery(2, "b", 200, MINUTE_MS, {
      event: "installation",
      action: "deleted",
      redelivery: true,
    });
    const push = makeDelivery(3, "a", 502, 20 * MINUTE_MS);

    expect(selectIds([retry, push])).toEqual([]);
  });

  it("does not let another installation's removal hold a push back", () => {
    const removal = makeDelivery(2, "b", 200, HOUR_MS, {
      event: "installation",
      action: "deleted",
      installationId: 200,
    });
    const push = makeDelivery(1, "a", 502, 2 * HOUR_MS);

    expect(selectIds([removal, push])).toEqual([1]);
  });

  it("names the original delivery, oldest first", () => {
    expect(
      selectIds([
        makeDelivery(3, "b", 502, HOUR_MS),
        makeDelivery(4, "a", 502, 2 * HOUR_MS),
      ]),
    ).toEqual([4, 3]);
  });

  it("sends at most twenty in one tick", () => {
    const failed = Array.from({ length: 30 }, (_, index) =>
      makeDelivery(index + 1, `g${String(index)}`, 502, HOUR_MS + index),
    );

    expect(selectIds(failed)).toHaveLength(20);
  });
});

describe("the reconcile task", () => {
  function makeRedeliverSpy(
    failOn?: number,
    failure: { readonly code: string; readonly status?: number } = {
      code: "unexpected",
      status: 422,
    },
  ): {
    readonly sent: number[];
    readonly redeliver: ReconcileWebhookDeliveriesTaskDeps["redeliver"];
  } {
    const sent: number[] = [];
    return {
      sent,
      async redeliver(id) {
        sent.push(Number(id));
        return Number(id) === failOn
          ? { ok: false, error: failure }
          : { ok: true, value: undefined };
      },
    };
  }

  it("resends across pages until deliveries pass the look-back", async () => {
    const spy = makeRedeliverSpy();
    const asked: (string | undefined)[] = [];
    const task = createReconcileWebhookDeliveriesTask({
      listDeliveries: async (cursor) => {
        asked.push(cursor);
        if (cursor === undefined) {
          return {
            ok: true,
            value: {
              deliveries: [makeDelivery(1, "a", 502, HOUR_MS)],
              nextCursor: "next",
            },
          };
        }
        return {
          ok: true,
          value: {
            deliveries: [makeDelivery(2, "b", 502, 80 * HOUR_MS)],
            nextCursor: "never-read",
          },
        };
      },
      redeliver: spy.redeliver,
      log: captureLogger().logger,
      now: () => NOW,
    });

    await task();

    expect(asked).toEqual([undefined, "next"]);
    expect(spy.sent).toEqual([1]);
  });

  it("moves past a delivery GitHub refuses alone", async () => {
    const spy = makeRedeliverSpy(1, { code: "not-found", status: 404 });
    const task = createReconcileWebhookDeliveriesTask({
      listDeliveries: async () => ({
        ok: true,
        value: {
          deliveries: [
            makeDelivery(2, "b", 502, HOUR_MS),
            makeDelivery(1, "a", 502, 2 * HOUR_MS),
          ],
        },
      }),
      redeliver: spy.redeliver,
      log: captureLogger().logger,
      now: () => NOW,
    });

    await task();

    expect(spy.sent).toEqual([1, 2]);
  });

  it("ends the tick when GitHub reads the attempts as spam", async () => {
    const spy = makeRedeliverSpy(1, { code: "unexpected", status: 422 });
    const capture = captureLogger();
    const task = createReconcileWebhookDeliveriesTask({
      listDeliveries: async () => ({
        ok: true,
        value: {
          deliveries: [
            makeDelivery(2, "b", 502, HOUR_MS),
            makeDelivery(1, "a", 502, 2 * HOUR_MS),
          ],
        },
      }),
      redeliver: spy.redeliver,
      log: capture.logger,
      now: () => NOW,
    });

    await task();

    expect(spy.sent).toEqual([1]);
  });

  it("leaves a failed list for the next tick without throwing", async () => {
    const spy = makeRedeliverSpy();
    const task = createReconcileWebhookDeliveriesTask({
      listDeliveries: async () => ({
        ok: false,
        error: { code: "server-error" },
      }),
      redeliver: spy.redeliver,
      log: captureLogger().logger,
      now: () => NOW,
    });

    await expect(task()).resolves.toBeUndefined();

    expect(spy.sent).toEqual([]);
  });

  it("reads no more than its page limit", async () => {
    const spy = makeRedeliverSpy();
    let pages = 0;
    const task = createReconcileWebhookDeliveriesTask({
      listDeliveries: async () => {
        pages += 1;
        return { ok: true, value: { deliveries: [], nextCursor: "more" } };
      },
      redeliver: spy.redeliver,
      log: captureLogger().logger,
      now: () => NOW,
    });

    await task();

    expect(pages).toBe(10);
  });
});
