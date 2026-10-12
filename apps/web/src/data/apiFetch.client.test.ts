// @vitest-environment jsdom
// The browser branch of `apiFetch`: a read's 401 GitHub answered for a live
// session sends the viewer to sign in, unless the caller reads it as signed
// out; a write's 401 stays with its caller; a `signed-out` 401 never leaves
// and reports the session gone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, ApiErrorCodes, type ApiErrorCode } from "./apiFetch";
import { subscribeSignedOut } from "./signed-out";

const assign = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const signedOutListener = vi.fn();
let unsubscribeSignedOut: () => void = () => undefined;

function answerWith(
  status: number,
  code: ApiErrorCode = ApiErrorCodes.UNAUTHORIZED,
): void {
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ code }), { status })),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
  unsubscribeSignedOut = subscribeSignedOut(signedOutListener);
});

afterEach(() => {
  window.localStorage.clear();
  assign.mockReset();
  fetchMock.mockReset();
  unsubscribeSignedOut();
  signedOutListener.mockReset();
  vi.unstubAllGlobals();
});

describe("apiFetch in the browser", () => {
  it("sends the viewer to sign in on a 401 from a read", async () => {
    answerWith(401);

    const response = await apiFetch("/api/repos/1/pulls/2/diff");

    expect(response.status).toBe(401);
    expect(assign).toHaveBeenCalledWith("/api/auth/github");
    expect(signedOutListener).not.toHaveBeenCalled();
  });

  it("keeps the viewer on the page when a write is refused", async () => {
    answerWith(401);

    const response = await apiFetch("/api/repos/1/pulls/2/comments", {
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends the viewer to sign in on a refused write with nothing typed", async () => {
    answerWith(401);

    await apiFetch("/api/repos/1/pulls/2/archive", {
      method: "PUT",
      unauthorizedLeavesForSignIn: true,
    });

    expect(assign).toHaveBeenCalledWith("/api/auth/github");
  });

  it("sends the viewer once when several requests are refused together", async () => {
    answerWith(401);

    await Promise.all([
      apiFetch("/api/repos/1/pulls/2/diff"),
      apiFetch("/api/repos/1/pulls/2/conversation"),
      apiFetch("/api/repos/1/pulls/2/comments", { method: "POST" }),
    ]);

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("leaves a 401 the caller reads as signed out to the caller", async () => {
    answerWith(401);

    await apiFetch("/api/auth/session", { unauthorizedIsSignedOut: true });

    expect(assign).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty(
      "unauthorizedIsSignedOut",
    );
  });

  it("stays put on a signed-out 401 and reports the session gone", async () => {
    answerWith(401, ApiErrorCodes.SIGNED_OUT);

    const response = await apiFetch("/api/repos/1/pulls/2/diff");

    expect(assign).not.toHaveBeenCalled();
    expect(signedOutListener).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ code: "signed-out" });
  });

  it("reports a signed-out 401 on a read that renders signed out", async () => {
    answerWith(401, ApiErrorCodes.SIGNED_OUT);

    await apiFetch("/api/inbox", { unauthorizedIsSignedOut: true });

    expect(signedOutListener).toHaveBeenCalledTimes(1);
  });

  it("sends a codeless 401 to sign in without reporting signed out", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));

    await apiFetch("/api/repos/1/pulls/2/diff");

    expect(assign).toHaveBeenCalledWith("/api/auth/github");
    expect(signedOutListener).not.toHaveBeenCalled();
  });

  it("leaves every other refusal to the caller", async () => {
    answerWith(403);

    await apiFetch("/api/repos/1/pulls/2/comments", { method: "POST" });

    expect(assign).not.toHaveBeenCalled();
  });
});
