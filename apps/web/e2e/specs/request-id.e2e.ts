// The web tier mints the request id the api's lines join on: a value the
// client sends never reaches the api, which echoes the one it received.
import { expect, test } from "@playwright/test";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("a client-sent request id is replaced before the api sees it", async ({
  request,
}) => {
  const response = await request.get("/api/version", {
    headers: { "x-request-id": "client-chosen" },
  });

  const echoed = response.headers()["x-request-id"];
  expect(echoed).not.toBe("client-chosen");
  expect(echoed).toMatch(UUID);
});
