import { HttpStatuses } from "types";
import { describe, expect, it, vi } from "vitest";

import { createDemoFetch } from "./index";

describe("createDemoFetch", () => {
  it("passes anything outside the API through untouched", async () => {
    const passThrough = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response("asset")),
    );
    const demoFetch = createDemoFetch(passThrough);
    const init = { method: "GET" };

    const response = await demoFetch("/assets/app.js", init);

    expect(await response.text()).toBe("asset");
    expect(passThrough).toHaveBeenCalledWith("/assets/app.js", init);
  });

  it("answers an API path from the fixtures without calling through", async () => {
    const passThrough = vi.fn<typeof fetch>();
    const demoFetch = createDemoFetch(passThrough);

    const response = await demoFetch("/api/version");

    expect(response.status).toBe(HttpStatuses.OK);
    expect(passThrough).not.toHaveBeenCalled();
  });

  it("reads the method and URL off a Request object", async () => {
    const demoFetch = createDemoFetch(vi.fn<typeof fetch>());

    const response = await demoFetch(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );

    expect(response.status).toBe(HttpStatuses.NO_CONTENT);
  });
});
