import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import {
  parseInboxResponse,
  type inboxCountsSchema,
  type inboxGenerationSchema,
  type inboxItemSchema,
  type inboxRepositorySchema,
  type inboxResponseSchema,
  type inboxStackPositionSchema,
  type inboxViewerSchema,
  type reachableInstallationSchema,
} from "./schemas";
import { wireInboxPageFixture as WIRE_PAGE } from "./test-utils";
import type {
  InboxCounts,
  InboxGeneration,
  InboxItem,
  InboxPage,
  InboxRepository,
  InboxStackPosition,
  InboxViewer,
  ReachableInstallation,
} from "./types";

const [ITEM] = WIRE_PAGE.items;

describe("parseInboxResponse", () => {
  it("reads a full page", () => {
    expect(parseInboxResponse(WIRE_PAGE)).toEqual({
      ok: true,
      value: WIRE_PAGE,
    });
  });

  it("keeps the wire's nulls on a pasted row with no brief yet", () => {
    const pasted = {
      ...ITEM,
      repoSlug: null,
      title: null,
      installationId: null,
      reviewState: null,
      generation: null,
      latestBriefAt: null,
      githubUpdatedAt: null,
      stack: null,
    };
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [pasted],
      viewer: { login: null, avatarUrl: "https://a/1" },
      installUrl: null,
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.items[0]).toEqual(pasted);
    expect(parsed.value.installUrl).toBeNull();
  });

  it("reads a null author login as absent", () => {
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [{ ...ITEM, authorLogin: null }],
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.items[0]?.authorLogin).toBeUndefined();
  });

  it.each([
    ["an unknown PR state", { items: [{ ...ITEM, state: "draft" }] }],
    ["a negative count", { counts: { ...WIRE_PAGE.counts, new: -1 } }],
    ["a zero page", { page: 0 }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseInboxResponse({ ...WIRE_PAGE, ...overrides }).ok).toBe(false);
  });
});

const SCHEMA_PINS = {
  InboxGeneration: true satisfies Equals<
    z.output<typeof inboxGenerationSchema>,
    InboxGeneration
  >,
  InboxStackPosition: true satisfies Equals<
    z.output<typeof inboxStackPositionSchema>,
    InboxStackPosition
  >,
  InboxItem: true satisfies Equals<z.output<typeof inboxItemSchema>, InboxItem>,
  InboxCounts: true satisfies Equals<
    z.output<typeof inboxCountsSchema>,
    InboxCounts
  >,
  InboxViewer: true satisfies Equals<
    z.output<typeof inboxViewerSchema>,
    InboxViewer
  >,
  ReachableInstallation: true satisfies Equals<
    z.output<typeof reachableInstallationSchema>,
    ReachableInstallation
  >,
  InboxRepository: true satisfies Equals<
    z.output<typeof inboxRepositorySchema>,
    InboxRepository
  >,
  InboxPage: true satisfies Equals<
    z.output<typeof inboxResponseSchema>,
    InboxPage
  >,
} as const;

describe("inbox schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
