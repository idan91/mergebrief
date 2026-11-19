import {
  buildOperationPath,
  ProductActionIds,
  ProductQueryIds,
} from "contract";
import { DiffSides, HttpMethods, HttpStatuses } from "types";
import { describe, expect, it, vi } from "vitest";

import { DEMO_PR } from "./consts";
import { createDemoFetch } from "./index";

const PULL = { repoId: DEMO_PR.repoId, prNumber: DEMO_PR.prNumber };
const SPAN = "?base=base-sha&head=head-sha";

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

  it("keeps a saved draft for the next session read in the same tab", async () => {
    const demoFetch = createDemoFetch(vi.fn<typeof fetch>());
    const draftPath = buildOperationPath(
      ProductActionIds.CREATE_DRAFT_COMMENT,
      PULL,
    );
    const sessionPath = buildOperationPath(
      ProductQueryIds.READ_REVIEW_SESSION,
      PULL,
    );

    const created = await demoFetch(`${draftPath}${SPAN}`, {
      method: HttpMethods.POST,
      body: JSON.stringify({
        filePath: "README.md",
        side: DiffSides.NEW,
        startLine: 1,
        endLine: 1,
        body: "Saved as a draft",
      }),
    });
    const session = await demoFetch(`${sessionPath}${SPAN}`);
    const payload: { draftComments: { body: string }[] } = await session.json();

    expect(created.status).toBe(HttpStatuses.CREATED);
    expect(payload.draftComments.map((draft) => draft.body)).toEqual([
      "Saved as a draft",
    ]);
  });
});
