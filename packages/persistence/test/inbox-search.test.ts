// The Inbox list narrowed by search text: words against the title, digits
// against the pull request number, and the total the other filters hide.
import { sql } from "drizzle-orm";
import {
  InboxArchivedFilters,
  InboxAuthorFilters,
  InboxLayouts,
  InboxSorts,
  InboxStatuses,
} from "types/inbox";
import { describe, expect, it } from "vitest";
import {
  createInboxStore,
  createTenantRepository,
  type AppDatabase,
  type InboxFilters,
  type InboxPage,
  type PullRequestLifecycle,
  type ScopeContext,
} from "../src/index";
import { internal } from "../src/db/handle";
import {
  isInstallationId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const ACME: InstallationId = brandWith(isInstallationId, 10n);
const VIEWER: ReviewerId = brandWith(isReviewerId, 501n);
const REPO: RepoId = brandWith(isRepoId, 100n);
const CTX: ScopeContext = { installationId: ACME };

const DEFAULT_FILTERS: InboxFilters = {
  statuses: [InboxStatuses.OPEN, InboxStatuses.DRAFT],
  author: InboxAuthorFilters.ALL,
  archived: InboxArchivedFilters.HIDE,
};

const OPEN: PullRequestLifecycle = { state: PrStates.OPEN };
const MERGED: PullRequestLifecycle = {
  state: PrStates.MERGED,
  closedAt: new Date("2026-09-02T00:00:00Z"),
};

async function seedTitled(
  handle: AppDatabase,
  prNumber: number,
  title: string | null,
  lifecycle: PullRequestLifecycle = OPEN,
): Promise<PullRequestRowId> {
  const row = await createTenantRepository(handle, CTX).pullRequests.upsert({
    repoId: REPO,
    prNumber,
    repoSlug: "acme/web",
    title: title ?? "to be purged",
    authorLogin: "noa",
    draft: false,
    githubUpdatedAt: new Date("2026-09-01T00:00:00Z"),
    ...lifecycle,
  });
  if (title === null) {
    await internal(handle).execute(
      sql`update pull_request set title = null where id = ${row.id}`,
    );
  }
  return brandWith(isPullRequestRowId, row.id);
}

async function searchInbox(
  handle: AppDatabase,
  searchText: string,
  filters: InboxFilters = DEFAULT_FILTERS,
): Promise<InboxPage> {
  return createInboxStore(handle).list({
    installationIds: [ACME],
    allowedRepoIds: [REPO],
    ownerUserId: VIEWER,
    reviewerId: VIEWER,
    reviewerLogin: "octocat",
    filters: { ...filters, searchText },
    sort: InboxSorts.UPDATED,
    layout: InboxLayouts.FOLDED,
    page: 1,
    pageSize: 25,
  });
}

function readNumbers(page: InboxPage): number[] {
  const numbers = page.items.map((item) => item.pullRequest.prNumber);
  return numbers.toSorted((left, right) => left - right);
}

describe("createInboxStore.list, search text on the title", () => {
  it("matches a word inside the title whatever its case", async () => {
    await seedTitled(shared.handle, 7, "Sanitize Anchor IDs");
    await seedTitled(shared.handle, 8, "Bump the node version");

    const page = await searchInbox(shared.handle, "ANCHOR");

    expect(readNumbers(page)).toEqual([7]);
    expect(page.total).toBe(1);
  });

  it("needs every word, in any order", async () => {
    await seedTitled(shared.handle, 7, "Sanitize anchor ids");
    await seedTitled(shared.handle, 8, "Anchor view cleanup");

    const page = await searchInbox(shared.handle, "ids  anchor");

    expect(readNumbers(page)).toEqual([7]);
  });

  it("reads a percent sign and an underscore as plain characters", async () => {
    await seedTitled(shared.handle, 7, "Raise coverage to 100%");
    await seedTitled(shared.handle, 8, "Raise coverage to 1000");
    await seedTitled(shared.handle, 9, "Rename snake_case keys");
    await seedTitled(shared.handle, 10, "Rename snakeXcase keys");

    const percent = await searchInbox(shared.handle, "100%");
    const underscore = await searchInbox(shared.handle, "snake_case");

    expect(readNumbers(percent)).toEqual([7]);
    expect(readNumbers(underscore)).toEqual([9]);
  });

  it("reads a backslash as a plain character", async () => {
    await seedTitled(shared.handle, 7, "Fix the C:\\temp path");
    await seedTitled(shared.handle, 8, "Fix the C:temp path");

    const page = await searchInbox(shared.handle, "C:\\temp");

    expect(readNumbers(page)).toEqual([7]);
  });

  it("blank search text narrows nothing", async () => {
    await seedTitled(shared.handle, 7, "Sanitize anchor ids");
    await seedTitled(shared.handle, 8, "Bump the node version");

    const page = await searchInbox(shared.handle, "   ");

    expect(readNumbers(page)).toEqual([7, 8]);
  });
});

describe("createInboxStore.list, search text on the number", () => {
  it("matches a number that starts with the digits typed", async () => {
    await seedTitled(shared.handle, 1412, "Sanitize anchor ids");
    await seedTitled(shared.handle, 141, "Bump the node version");
    await seedTitled(shared.handle, 2141, "Trim the lockfile");

    const page = await searchInbox(shared.handle, "141");

    expect(readNumbers(page)).toEqual([141, 1412]);
  });

  it("takes a leading hash sign as part of the number", async () => {
    await seedTitled(shared.handle, 1412, "Sanitize anchor ids");
    await seedTitled(shared.handle, 2141, "Trim the lockfile");

    const page = await searchInbox(shared.handle, "#141");

    expect(readNumbers(page)).toEqual([1412]);
  });

  it("still finds the digits inside a title", async () => {
    await seedTitled(shared.handle, 30, "Move the wire to v2");
    await seedTitled(shared.handle, 31, "Bump the node version");

    const page = await searchInbox(shared.handle, "2");

    expect(readNumbers(page)).toEqual([30]);
  });

  it("finds a row with no stored title by its number alone", async () => {
    await seedTitled(shared.handle, 1412, null);

    const byNumber = await searchInbox(shared.handle, "1412");
    const byWord = await searchInbox(shared.handle, "anchor");

    expect(readNumbers(byNumber)).toEqual([1412]);
    expect(readNumbers(byWord)).toEqual([]);
  });

  it("combines a title word with a number word", async () => {
    await seedTitled(shared.handle, 1412, "Sanitize anchor ids");
    await seedTitled(shared.handle, 1413, "Bump the node version");

    const page = await searchInbox(shared.handle, "141 anchor");

    expect(readNumbers(page)).toEqual([1412]);
  });
});

describe("createInboxStore.list, matches the filters hide", () => {
  it("counts every match, merged and archived rows included", async () => {
    const handle = shared.handle;
    await seedTitled(handle, 1412, "Sanitize anchor ids", MERGED);
    const archived = await seedTitled(handle, 1375, "Anchor plan refactor");
    await seedTitled(handle, 1400, "Anchor view cleanup");
    await seedTitled(handle, 1401, "Bump the node version");
    await createTenantRepository(handle, CTX).archives.set(archived, VIEWER);

    const page = await searchInbox(handle, "anchor");

    expect(readNumbers(page)).toEqual([1400]);
    expect(page.total).toBe(1);
    expect(page.searchMatchTotal).toBe(3);
  });

  it("an empty page still carries the matches outside the view", async () => {
    await seedTitled(shared.handle, 1412, "Sanitize anchor ids", MERGED);

    const page = await searchInbox(shared.handle, "anchor");

    expect(page.total).toBe(0);
    expect(page.searchMatchTotal).toBe(1);
  });

  it("counts nothing without search text", async () => {
    await seedTitled(shared.handle, 1412, "Sanitize anchor ids");

    const page = await searchInbox(shared.handle, "");

    expect(page.total).toBe(1);
    expect(page.searchMatchTotal).toBe(0);
  });

  it("leaves the review-state counts as they are without a search", async () => {
    await seedTitled(shared.handle, 1400, "Anchor view cleanup");
    await seedTitled(shared.handle, 1401, "Bump the node version");

    const page = await searchInbox(shared.handle, "anchor");

    expect(page.counts.new).toBe(2);
  });
});
