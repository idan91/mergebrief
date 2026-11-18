import { describe, expect, it } from "vitest";
import { stampDocumentHeaders } from "./document-headers";

const TIMING = 'api;desc="GET /api/inbox @0ms";dur=4, api-total;dur=4';

function makeResponse(contentType: string): Response {
  return new Response("<p>body</p>", {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("stampDocumentHeaders", () => {
  it("adds no-store and the read timings to an HTML document", async () => {
    const stamped = stampDocumentHeaders(
      makeResponse("text/html; charset=utf-8"),
      TIMING,
    );

    expect(stamped.headers.get("cache-control")).toBe("no-store");
    expect(stamped.headers.get("server-timing")).toBe(TIMING);
    expect(stamped.status).toBe(200);
    expect(await stamped.text()).toBe("<p>body</p>");
  });

  it("adds no timing header to a document that made no reads", () => {
    const stamped = stampDocumentHeaders(makeResponse("text/html"), undefined);

    expect(stamped.headers.get("cache-control")).toBe("no-store");
    expect(stamped.headers.has("server-timing")).toBe(false);
  });

  it("leaves a non-HTML response untouched", () => {
    const response = makeResponse("application/javascript");

    const stamped = stampDocumentHeaders(response, TIMING);

    expect(stamped).toBe(response);
    expect(stamped.headers.has("server-timing")).toBe(false);
    expect(stamped.headers.has("cache-control")).toBe(false);
  });
});
