// The seeded Inbox: two installations the viewer reaches, their rows in
// every review state the fold sorts by, one draft, one of the viewer's own, plus the
// committed fixture brief as the viewer's URL row. The seed writes these
// rows, the GitHub stub answers for these installations, and the spec asserts
// on these titles.
export const E2E_VIEWER_LOGIN = "e2e-viewer";
/** Every seeded row that is not the viewer's belongs to this login. */
export const E2E_OTHER_LOGIN = "mira-k";

export interface InboxFixtureRepo {
  readonly id: number;
  readonly slug: string;
  /** GitHub says the viewer administers it: the stub answers `permissions.admin`. */
  readonly admin?: boolean;
}

export interface InboxFixtureInstallation {
  readonly id: number;
  readonly account: string;
  readonly repos: readonly InboxFixtureRepo[];
}

export const INBOX_INSTALLATIONS: readonly InboxFixtureInstallation[] = [
  {
    id: 7001,
    account: "acme",
    repos: [
      { id: 424243, slug: "acme/payments", admin: true },
      { id: 424244, slug: "acme/billing" },
    ],
  },
  {
    id: 7002,
    account: "halden",
    repos: [{ id: 424245, slug: "halden/ledger" }],
  },
];

/**
 * The row the delete spec erases, in the repository the viewer administers.
 * The specs share one seeded database, so only that spec may touch it.
 */
export const INBOX_DELETE_ROW_NUMBER = 107;
/** The row the bulk spec deletes, in the repository the viewer administers. */
export const INBOX_BULK_DELETE_ROW_NUMBER = 108;
/** The two rows the bulk spec archives, in a repository the viewer does not administer. */
export const INBOX_BULK_ARCHIVE_ROW_NUMBERS = [109, 110] as const;

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
  /** Days before the seed ran that GitHub opened it; the created sort's key, in no order the update times share. */
  readonly createdDaysAgo: number;
}

export const INBOX_ROWS: readonly InboxFixtureRow[] = [
  {
    installationId: 7001,
    repoId: 424243,
    prNumber: 101,
    title: "Retry failed webhook deliveries with backoff",
    state: InboxSeedStates.NEW,
    updatedMinutesAgo: 20,
    createdDaysAgo: 20,
  },
  {
    installationId: 7001,
    repoId: 424243,
    prNumber: 102,
    title: "Move invoice rounding into the `ledger` package",
    state: InboxSeedStates.UPDATED,
    updatedMinutesAgo: 95,
    createdDaysAgo: 18,
  },
  {
    installationId: 7001,
    repoId: 424244,
    prNumber: 103,
    title: "Add a per-tenant rate limit to the export endpoint",
    state: InboxSeedStates.IN_PROGRESS,
    updatedMinutesAgo: 190,
    createdDaysAgo: 40,
  },
  {
    installationId: 7002,
    repoId: 424245,
    prNumber: 104,
    title: "Paginate the ledger entries endpoint",
    state: InboxSeedStates.REVIEWED,
    draft: true,
    updatedMinutesAgo: 340,
    createdDaysAgo: 14,
  },
  {
    installationId: 7002,
    repoId: 424245,
    prNumber: 106,
    title: "Let operators pause a payout batch",
    state: InboxSeedStates.YOURS,
    updatedMinutesAgo: 420,
    createdDaysAgo: 3,
  },
  {
    installationId: 7001,
    repoId: 424243,
    prNumber: INBOX_DELETE_ROW_NUMBER,
    title: "Drop the legacy settlement exporter",
    state: InboxSeedStates.YOURS,
    updatedMinutesAgo: 500,
    createdDaysAgo: 10,
  },
  {
    installationId: 7001,
    repoId: 424243,
    prNumber: INBOX_BULK_DELETE_ROW_NUMBER,
    title: "Fold the refund ledger into settlements",
    state: InboxSeedStates.YOURS,
    updatedMinutesAgo: 560,
    createdDaysAgo: 8,
  },
  {
    installationId: 7002,
    repoId: 424245,
    prNumber: INBOX_BULK_ARCHIVE_ROW_NUMBERS[0],
    title: "Index ledger entries by posting date",
    state: InboxSeedStates.YOURS,
    updatedMinutesAgo: 620,
    createdDaysAgo: 6,
  },
  {
    installationId: 7002,
    repoId: 424245,
    prNumber: INBOX_BULK_ARCHIVE_ROW_NUMBERS[1],
    title: "Cache the ledger summary per account",
    state: InboxSeedStates.YOURS,
    updatedMinutesAgo: 680,
    createdDaysAgo: 5,
  },
];

/** A second URL row whose brief GitHub has moved past: the live read reports a newer head. */
export const INBOX_BEHIND_ROW = {
  prNumber: 2,
  title: "Correct the retry header on throttled responses",
  /** Old enough to sort after every installation row that needs the reviewer. */
  updatedMinutesAgo: 720,
  briefHead: "3333333300001111222233334444555566667777",
  githubHead: "6666666600001111222233334444555566667777",
} as const;
