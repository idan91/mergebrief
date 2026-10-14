import type {
  GenerationSummaryView,
  InboxCountsView,
  InboxItem as WireInboxItem,
  InboxRepositoryView,
  InboxResponse,
  InboxStackView,
  ReachableInstallationView,
  ViewerView,
} from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import { UNSAFE_LINKS } from "@web/test/links";
import { UnknownValues } from "@web/utils/open-enum/types";
import type { ReadsWireFields } from "@web/test/wire-fields";

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

  it("reads a pasted row's wire nulls as absent fields", () => {
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
      repositories: [{ repoId: "5", repoSlug: null }],
      installUrl: null,
    });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    const {
      repoSlug: _repoSlug,
      title: _title,
      installationId: _installationId,
      reviewState: _reviewState,
      generation: _generation,
      latestBriefAt: _latestBriefAt,
      githubUpdatedAt: _githubUpdatedAt,
      stack: _stack,
      ...present
    } = pasted;
    expect(parsed.value.items[0]).toStrictEqual(present);
    expect(parsed.value.viewer).toStrictEqual({ avatarUrl: "https://a/1" });
    expect(parsed.value.repositories).toStrictEqual([{ repoId: "5" }]);
    expect(parsed.value).not.toHaveProperty("installUrl");
  });

  it.each(UNSAFE_LINKS)("reads install url %j as no install link", (link) => {
    const parsed = parseInboxResponse({ ...WIRE_PAGE, installUrl: link });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value).not.toHaveProperty("installUrl");
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
    ["a negative count", { counts: { ...WIRE_PAGE.counts, new: -1 } }],
    ["a zero page", { page: 0 }],
    ["a missing PR state", { items: [{ ...ITEM, state: undefined }] }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseInboxResponse({ ...WIRE_PAGE, ...overrides }).ok).toBe(false);
  });

  it("reads a required vocabulary value this bundle predates as unknown", () => {
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [
        {
          ...ITEM,
          state: "reopened",
          source: "cli",
          generation: { status: "exploded", updatedAt: "2026-09-20T10:00:00Z" },
        },
      ],
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.items[0]).toMatchObject({
      state: UnknownValues.UNKNOWN,
      source: UnknownValues.UNKNOWN,
      generation: { status: UnknownValues.UNKNOWN },
    });
  });

  it("reads a review state this bundle predates as unknown", () => {
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [{ ...ITEM, reviewState: "snoozed" }],
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.items[0]?.reviewState).toBe(UnknownValues.UNKNOWN);
  });

  it("keeps every row when one carries a vocabulary value it predates", () => {
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [ITEM, { ...ITEM, prNumber: 8, state: "reopened" }],
      total: 2,
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.items.map((item) => item.prNumber)).toEqual([7, 8]);
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

const CONTRACT_PINS = {
  InboxGeneration: true satisfies ReadsWireFields<
    z.output<typeof inboxGenerationSchema>,
    GenerationSummaryView
  >,
  InboxStackPosition: true satisfies ReadsWireFields<
    z.output<typeof inboxStackPositionSchema>,
    InboxStackView
  >,
  InboxItem: true satisfies ReadsWireFields<
    z.output<typeof inboxItemSchema>,
    WireInboxItem
  >,
  InboxCounts: true satisfies ReadsWireFields<
    z.output<typeof inboxCountsSchema>,
    InboxCountsView
  >,
  InboxViewer: true satisfies ReadsWireFields<
    z.output<typeof inboxViewerSchema>,
    ViewerView
  >,
  ReachableInstallation: true satisfies ReadsWireFields<
    z.output<typeof reachableInstallationSchema>,
    ReachableInstallationView
  >,
  InboxRepository: true satisfies ReadsWireFields<
    z.output<typeof inboxRepositorySchema>,
    InboxRepositoryView
  >,
  InboxPage: true satisfies ReadsWireFields<
    z.output<typeof inboxResponseSchema>,
    InboxResponse
  >,
} as const;

describe("inbox schemas match their interfaces", () => {
  it.each(Object.entries(SCHEMA_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});

describe("inbox schemas read only what the contract sends", () => {
  it.each(Object.entries(CONTRACT_PINS))("%s is pinned", (_shape, pinned) => {
    expect(pinned).toBe(true);
  });
});
