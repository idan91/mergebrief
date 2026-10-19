import { requestHandler } from "@tanstack/react-start/server";
import { describe, expect, it } from "vitest";
import {
  readRenderRequestId,
  REQUEST_ID_HEADER,
  stampRequestId,
} from "./request-id";

describe("stampRequestId", () => {
  it("replaces a request id the client sent", () => {
    const inbound = new Request("http://web.test/api/pulls", {
      headers: { [REQUEST_ID_HEADER]: "client-chosen" },
    });

    const stamped = stampRequestId(inbound, "minted-id");

    expect(stamped.headers.get(REQUEST_ID_HEADER)).toBe("minted-id");
  });

  it("mints a fresh UUID for every request", () => {
    const first = stampRequestId(new Request("http://web.test/"));
    const second = stampRequestId(new Request("http://web.test/"));

    const firstId = first.headers.get(REQUEST_ID_HEADER) ?? "";
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.headers.get(REQUEST_ID_HEADER)).not.toBe(firstId);
  });

  it("keeps the method, url, other headers and body bytes", async () => {
    const body = '{"signed":"exactly these bytes"}';
    const inbound = new Request("http://web.test/api/webhooks/github?x=1", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=abc" },
      body,
    });

    const stamped = stampRequestId(inbound, "minted-id");

    expect(stamped.method).toBe("POST");
    expect(stamped.url).toBe("http://web.test/api/webhooks/github?x=1");
    expect(stamped.headers.get("x-hub-signature-256")).toBe("sha256=abc");
    expect(await stamped.text()).toBe(body);
  });

  it("follows the inbound request's abort signal", () => {
    const controller = new AbortController();
    const inbound = new Request("http://web.test/", {
      signal: controller.signal,
    });

    const stamped = stampRequestId(inbound, "minted-id");
    controller.abort();

    expect(stamped.signal.aborted).toBe(true);
  });

  it("stamps a request built by another fetch implementation", async () => {
    const native = new Request("http://web.test/api/x", {
      method: "POST",
      body: "payload",
    });
    const foreign = {
      url: native.url,
      method: native.method,
      headers: native.headers,
      body: native.body,
      signal: native.signal,
    } as unknown as Request;

    const stamped = stampRequestId(foreign, "minted-id");

    expect(stamped.headers.get(REQUEST_ID_HEADER)).toBe("minted-id");
    expect(await stamped.text()).toBe("payload");
  });
});

describe("readRenderRequestId", () => {
  it("reads the rendered request's id and is absent outside a render", async () => {
    const seen: (string | undefined)[] = [];
    const render = requestHandler(() => {
      seen.push(readRenderRequestId());
      return new Response(null);
    });

    const inbound = new Request("http://localhost/");
    await render(stampRequestId(inbound, "minted-id"), {});

    expect(seen).toEqual(["minted-id"]);
    expect(readRenderRequestId()).toBeUndefined();
  });
});
