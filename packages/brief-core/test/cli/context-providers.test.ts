import { describe, expect, it } from "vitest";
import {
  createCliContextProviders,
  createCliRootDeps,
} from "../../src/cli/context-providers";
import { resolvePrimaryRead } from "../../src/context/trackers";
import { ContextProviderTypes } from "../../src/context/types";
import { TicketTrackers } from "../../src/context/tracker";

describe("the CLIs' context root", () => {
  it("runs the URL chaser as its generic source", () => {
    expect(createCliContextProviders().map((p) => p.providerId)).toEqual([
      ContextProviderTypes.URL,
    ]);
  });

  it("offers GitHub through gh, so a repo with no tracker block reads GitHub", () => {
    const read = resolvePrimaryRead(undefined, createCliRootDeps({}));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.kind).toBe(TicketTrackers.GITHUB);
  });

  it("passes the env through by reference for token lookups", () => {
    const env = { NOTION_TOKEN: "ntn_x" };
    expect(createCliRootDeps(env).env).toBe(env);
  });
});
