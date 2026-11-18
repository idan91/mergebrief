import { act } from "@testing-library/react";

import { appI18n } from "../../../../../../../i18n/I18nProvider";

import type { GenerationSummary, PrSummary } from "../../../../../types";

/** A failed latest push with no brief; override per case. */
export function makeGeneration(
  overrides: Partial<GenerationSummary> = {},
): GenerationSummary {
  return {
    status: "failed",
    attempts: 0,
    errorCode: "provider-timeout",
    updatedAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

/** An open installation PR a pusher reads, behind its failed latest push. */
export function makeMeta(overrides: Partial<PrSummary> = {}): PrSummary {
  return {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "t",
    state: "open",
    headSha: "head-2",
    briefAvailable: false,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: true,
    viewerCanPush: true,
    appInstalled: true,
    behind: true,
    updatedAt: "2026-10-24T10:00:00.000Z",
    generation: makeGeneration(),
    ...overrides,
  };
}

/** A url row behind GitHub, read by a viewer without push access. */
export function makeUrlMeta(overrides: Partial<PrSummary> = {}): PrSummary {
  return makeMeta({ appInstalled: false, viewerCanPush: false, ...overrides });
}

/** The meta fields for a latest push with this generation. */
export function makeGenerationFields(
  overrides: Partial<GenerationSummary>,
): Partial<PrSummary> {
  return { generation: makeGeneration(overrides) };
}

/** What the chip's region says once a run is queued, and once its brief lands. */
export const queuedAnnouncement = appI18n.t(
  "pulls.newerCommits.announce.queued",
);
export const arrivedAnnouncement = appI18n.t(
  "pulls.newerCommits.announce.arrived",
);

/** How often a live region said `text`: every announcement empties it first. */
export function countAnnouncements(
  seen: readonly string[],
  text: string,
): number {
  const starts = seen.filter(
    (value, index) => value === text && seen[index - 1] !== text,
  );
  return starts.length;
}

/** Lets a poll's effects and the announcer's frame settle. */
export async function settlePoll(): Promise<void> {
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
}
