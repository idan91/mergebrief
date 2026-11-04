import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppClient } from "../src/auth/app";
import {
  listHookDeliveries,
  redeliverHookDelivery,
} from "../src/operations/hook-deliveries";
import { makeAppConfig, stubGitHubFetch } from "./client/helpers";

const LIST_PATH = "/app/hook/deliveries";
const DELIVERY = {
  id: 12345,
  guid: "0b989ba4",
  delivered_at: "2026-11-04T10:00:00Z",
  status_code: 502,
  event: "pull_request",
  action: "synchronize",
  redelivery: false,
  installation_id: 100,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubGitHub(
  route: Parameters<typeof stubGitHubFetch>[0],
): ReturnType<typeof stubGitHubFetch> {
  const stub = stubGitHubFetch(route);
  vi.stubGlobal("fetch", stub.fetch);
  return stub;
}

describe("listHookDeliveries", () => {
  it("reads a page on the App's JWT", async () => {
    const stub = stubGitHub((request) =>
      request.path === LIST_PATH
        ? { status: 200, body: [DELIVERY] }
        : { status: 404, body: {} },
    );

    const appClient = createAppClient(makeAppConfig());
    const listed = await listHookDeliveries(appClient);

    expect(listed).toEqual({
      ok: true,
      value: {
        deliveries: [
          {
            id: 12345,
            guid: "0b989ba4",
            deliveredAt: new Date("2026-11-04T10:00:00Z"),
            statusCode: 502,
            event: "pull_request",
            action: "synchronize",
            redelivery: false,
            installationId: 100,
          },
        ],
      },
    });
    expect(stub.requests[0]?.authorization).toMatch(/^bearer /i);
  });

  it("reads the next page's cursor off the Link header", async () => {
    stubGitHub(() => ({
      status: 200,
      body: [DELIVERY],
      headers: {
        link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=v1_77>; rel="next"',
      },
    }));

    const appClient = createAppClient(makeAppConfig());
    const listed = await listHookDeliveries(appClient);

    expect(listed.ok && listed.value.nextCursor).toBe("v1_77");
  });

  it("refuses a page off its shape", async () => {
    stubGitHub(() => ({ status: 200, body: { message: "odd" } }));

    const appClient = createAppClient(makeAppConfig());
    const listed = await listHookDeliveries(appClient);

    expect(listed.ok).toBe(false);
  });
});

describe("redeliverHookDelivery", () => {
  it("posts to the delivery's attempts", async () => {
    const stub = stubGitHub(() => ({ status: 202, body: {} }));

    const appClient = createAppClient(makeAppConfig());
    const sent = await redeliverHookDelivery(appClient, 12345);

    expect(sent.ok).toBe(true);
    expect(stub.requests[0]).toMatchObject({
      method: "POST",
      path: "/app/hook/deliveries/12345/attempts",
    });
  });

  it("answers a refusal as a failure", async () => {
    stubGitHub(() => ({ status: 422, body: { message: "spammed" } }));

    const appClient = createAppClient(makeAppConfig());
    const sent = await redeliverHookDelivery(appClient, 12345);

    expect(sent.ok).toBe(false);
  });
});
