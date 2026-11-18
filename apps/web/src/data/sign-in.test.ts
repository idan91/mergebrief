// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildSignInHref, requestSignIn } from "./sign-in";

const assign = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
});

afterEach(() => {
  window.localStorage.clear();
  assign.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("requestSignIn", () => {
  it("sends the browser to GitHub sign-in", () => {
    requestSignIn();

    expect(assign).toHaveBeenCalledWith("/api/auth/github");
  });

  it("sends the browser once for a burst of refusals", () => {
    requestSignIn();
    requestSignIn();
    requestSignIn();

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("stays put when a sign-in just came back still refused", () => {
    requestSignIn();
    vi.advanceTimersByTime(30_000);
    requestSignIn();

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("stays put while another tab's sign-in is under way", () => {
    window.localStorage.setItem(
      "mergebrief.signInRequestedAt",
      String(Date.now()),
    );

    requestSignIn();

    expect(assign).not.toHaveBeenCalled();
  });

  it("ignores a mark dated after now", () => {
    window.localStorage.setItem(
      "mergebrief.signInRequestedAt",
      String(Date.now() + 3_600_000),
    );

    requestSignIn();

    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("sends the browser again once the cooldown has passed", () => {
    requestSignIn();
    vi.advanceTimersByTime(121_000);
    requestSignIn();

    expect(assign).toHaveBeenCalledTimes(2);
  });
});

describe("buildSignInHref", () => {
  it("is the bare sign-in path without a return path", () => {
    expect(buildSignInHref()).toBe("/api/auth/github");
  });

  it("carries the return path encoded in returnTo", () => {
    expect(buildSignInHref("/repos/424242/pulls/1?rev=1&thread=9")).toBe(
      "/api/auth/github?returnTo=%2Frepos%2F424242%2Fpulls%2F1%3Frev%3D1%26thread%3D9",
    );
  });
});
