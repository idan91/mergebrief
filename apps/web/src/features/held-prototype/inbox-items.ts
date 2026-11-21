// PROTOTYPE (BRIEF-381): one inbox row per held case.
import type { InboxItem } from "@web/features/inbox/types";

import { HELD_CASES, PROTO_REPO_ID } from "./model";

const MINUTE_MS = 60_000;
const AGES_MIN = [4, 12, 26, 41, 63, 95, 180];

export function buildHeldInboxItems(now: number): InboxItem[] {
  return HELD_CASES.map((held, index) => ({
    repoId: PROTO_REPO_ID,
    repoSlug: held.repo,
    prNumber: held.prNumber,
    title: held.title,
    state: "open",
    draft: held.draft,
    source: "installation",
    authorLogin: held.author,
    viewerIsAuthor: false,
    viewerCanDelete: false,
    behind: false,
    unreachable: false,
    generation: {
      status: "held",
      updatedAt: new Date(now - (AGES_MIN[index] ?? 5) * MINUTE_MS).toISOString(),
    },
    githubUpdatedAt: new Date(now - (AGES_MIN[index] ?? 5) * MINUTE_MS).toISOString(),
  })) as unknown as InboxItem[];
}
