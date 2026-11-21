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

  it("reads a page from an API that predates the search counts", () => {
    const { searchMatchTotal, archivedSearchMatchTotal, ...older } = WIRE_PAGE;

    const parsed = parseInboxResponse(older);

    expect(parsed).toEqual({
      ok: true,
      value: { ...older, searchMatchTotal, archivedSearchMatchTotal },
    });
  });

  it("reads a page from an API that predates held heads", () => {
    const { heldTotal: _heldTotal, ...older } = WIRE_PAGE;
    const olderItem: Record<string, unknown> = { ...ITEM };
    delete olderItem["viewerCanPush"];
    delete olderItem["generateEveryPush"];

    const parsed = parseInboxResponse({ ...older, items: [olderItem] });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.heldTotal).toBe(0);
    expect(parsed.value.items[0]?.viewerCanPush).toBe(false);
    expect(parsed.value.items[0]?.generateEveryPush).toBe(false);
  });

  it("reads a held head's unmet conditions and drops an unknown kind", () => {
    const held = {
      status: "held",
      updatedAt: "2026-09-20T10:00:00Z",
      unmetConditions: [
        { kind: "ready-for-review", setBy: "instance" },
        { kind: "moon-phase", setBy: "repo" },
      ],
    };
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [{ ...ITEM, generation: held }],
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.items[0]?.generation).toEqual({
      ...held,
      unmetConditions: [{ kind: "ready-for-review", setBy: "instance" }],
      unmetConditionsPartial: true,
    });
  });

  it("drops unmet conditions that are not a list, keeping the row", () => {
    const held = { status: "held", updatedAt: "2026-09-20T10:00:00Z" };
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [{ ...ITEM, generation: { ...held, unmetConditions: "soon" } }],
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.items[0]?.generation).toEqual(held);
  });

  it("keeps GitHub's creation time when the wire carries it", () => {
    const dated = { ...ITEM, githubCreatedAt: "2026-09-01T08:00:00Z" };
    const parsed = parseInboxResponse({ ...WIRE_PAGE, items: [dated] });

    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(parsed.value.items[0]?.githubCreatedAt).toBe("2026-09-01T08:00:00Z");
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
      githubCreatedAt: null,
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
      githubCreatedAt: _githubCreatedAt,
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

  it("keeps a failed generation's code and drops one this bundle predates", () => {
    const failed = { status: "failed", updatedAt: "2026-09-20T10:00:00Z" };
    const parsed = parseInboxResponse({
      ...WIRE_PAGE,
      items: [
        { ...ITEM, generation: { ...failed, errorCode: "diff-too-large" } },
        { ...ITEM, generation: { ...failed, errorCode: "exploded" } },
      ],
    });

    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.value.items[0]?.generation?.errorCode).toBe("diff-too-large");
    expect(parsed.value.items[1]?.generation).toEqual(failed);
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

void SCHEMA_PINS;

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

void CONTRACT_PINS;
