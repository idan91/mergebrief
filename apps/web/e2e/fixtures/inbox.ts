// The seeded Inbox: two installations the viewer reaches, their rows in
// every review state the fold sorts by, one draft, one of the viewer's own, plus the
// committed fixture brief as the viewer's URL row. The seed writes these
// rows, the GitHub stub answers for these installations, and the spec asserts
// on these titles.
import { FIXTURE_PR_TITLE } from "./ids";

export const E2E_VIEWER_LOGIN = "e2e-viewer";

export interface InboxFixtureInstallation {
  readonly id: number;
  readonly account: string;
  readonly repos: readonly { readonly id: number; readonly slug: string }[];
}

export const INBOX_INSTALLATIONS: readonly InboxFixtureInstallation[] = [
  {
    id: 7001,
    account: "acme",
    repos: [
      { id: 424243, slug: "acme/payments" },
      { id: 424244, slug: "acme/billing" },
    ],
  },
  {
    id: 7002,
    account: "halden",
    repos: [{ id: 424245, slug: "halden/ledger" }],
  },
];

export const InboxSeedStates = {
  NEW: "new",
  UPDATED: "updated",
  IN_PROGRESS: "in-progress",
  REVIEWED: "reviewed",
  YOURS: "yours",
} as const;

export interface InboxFixtureRow {
  readonly installationId: number;
  readonly repoId: number;
  readonly prNumber: number;
  readonly title: string;
  readonly state: (typeof InboxSeedStates)[keyof typeof InboxSeedStates];
  readonly draft?: boolean;
  /** Minutes before the seed ran; the list sorts by it. */
  readonly updatedMinutesAgo: number;
}

export const INBOX_ROWS: readonly InboxFixtureRow[] = [
  {
    installationId: 7001,
    repoId: 424243,
    prNumber: 101,
    title: "Retry failed webhook deliveries with backoff",
    state: InboxSeedStates.NEW,
    updatedMinutesAgo: 20,
  },
  {
    installationId: 7001,
    repoId: 424243,
    prNumber: 102,
    title: "Move invoice rounding into the `ledger` package",
    state: InboxSeedStates.UPDATED,
    updatedMinutesAgo: 95,
  },
  {
    installationId: 7001,
    repoId: 424244,
    prNumber: 103,
    title: "Add a per-tenant rate limit to the export endpoint",
    state: InboxSeedStates.IN_PROGRESS,
    updatedMinutesAgo: 190,
  },
  {
    installationId: 7002,
    repoId: 424245,
    prNumber: 104,
    title: "Paginate the ledger entries endpoint",
    state: InboxSeedStates.REVIEWED,
    draft: true,
    updatedMinutesAgo: 340,
  },
  {
    installationId: 7002,
    repoId: 424245,
    prNumber: 106,
    title: "Let operators pause a payout batch",
    state: InboxSeedStates.YOURS,
    updatedMinutesAgo: 420,
  },
];

/** The committed fixture brief, as the viewer's own URL row: new, open, read live. */
export const INBOX_URL_ROW_TITLE = FIXTURE_PR_TITLE;

/** A second URL row whose brief GitHub has moved past: the live read reports a newer head. */
export const INBOX_BEHIND_ROW = {
  prNumber: 2,
  title: "Correct the retry header on throttled responses",
  /** Old enough to sort after every installation row that needs the reviewer. */
  updatedMinutesAgo: 720,
  briefHead: "3333333300001111222233334444555566667777",
  githubHead: "6666666600001111222233334444555566667777",
} as const;
