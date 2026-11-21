// Fetch-level GitHub stub for the e2e server process (loaded via
// NODE_OPTIONS --import). Everything the suite needs from api.github.com is
// served from the committed fixtures; anything else answers 404 so a new
// GitHub dependency fails loudly instead of hitting the network.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = process.env.MERGEBRIEF_E2E_FIXTURES;
const REPO_ID = process.env.MERGEBRIEF_E2E_REPO_ID ?? "424242";
const REPO_SLUG =
  process.env.MERGEBRIEF_E2E_REPO_SLUG ?? "mergebrief/e2e-fixture";
const CODELESS_HEADS = new Set(
  JSON.parse(process.env.MERGEBRIEF_E2E_CODELESS_HEADS ?? "[]"),
);
const INBOX = JSON.parse(
  process.env.MERGEBRIEF_E2E_INBOX ?? '{"installations":[],"urlRows":[]}',
);
const OUTDATED_THREADS = JSON.parse(
  process.env.MERGEBRIEF_E2E_OUTDATED_THREADS ?? "[]",
);
const OUTDATED_THREAD_PATH =
  "apps/web/src/features/brief/components/BriefPage/BriefPage.tsx";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const SYNTHETIC_FILE_LINES = 900;
const FIXTURE_PR_NUMBER = 1;
/** Compares between two fixture heads, by both heads' first eight characters. */
const BETWEEN_HEADS_DIFFS = new Map([
  [
    "11111111...22222222",
    fileURLToPath(
      new URL("../fixtures/previous-brief-span-diffs.json", import.meta.url),
    ),
  ],
]);
const realFetch = globalThis.fetch;

function buildFixturePull(number) {
  const repo = {
    id: Number(REPO_ID),
    name: REPO_SLUG.split("/")[1],
    full_name: REPO_SLUG,
    owner: { login: REPO_SLUG.split("/")[0] },
  };
  return {
    number,
    state: "open",
    draft: false,
    merged: false,
    labels: [],
    title: "feat: front-door accessibility and keyboard navigation",
    body: "",
    html_url: `https://github.com/${REPO_SLUG}/pull/${number}`,
    commits: 2,
    user: { login: "e2e-author" },
    closed_at: null,
    updated_at: new Date(0).toISOString(),
    created_at: new Date(0).toISOString(),
    head: {
      sha: "22222222eeee3333ffff4444aaaa5555bbbb6666",
      ref: "e2e-fixture",
      repo,
    },
    base: {
      sha: "0000000099998888777766665555444433332222",
      ref: "main",
      repo,
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function joinPatches(path) {
  const entries = JSON.parse(readFileSync(path, "utf8"));
  return entries.map((entry) => entry.patch).join("\n");
}

/**
 * The compare between two heads: GitHub's diff of the revision span when the
 * second head fast-forwards the first, as the fixture's does.
 */
function loadHeadsDiff(base8, head8) {
  const path = BETWEEN_HEADS_DIFFS.get(`${base8}...${head8}`);
  return path === undefined ? undefined : joinPatches(path);
}

/** Concatenated unified patches for the revision whose head starts `head8`. */
function loadDiff(head8) {
  const names = readdirSync(FIXTURE_DIR).filter((name) =>
    name.endsWith(`${head8}.diffs.json`),
  );
  const name = names[0];
  if (name === undefined) {
    return undefined;
  }
  return joinPatches(join(FIXTURE_DIR, name));
}

function isDiffRequest(input, init) {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  return (headers.get("accept") ?? "").includes("diff");
}

/**
 * The compare's JSON: every head branched off its base's tip, so the merge
 * base is the base itself and the second head fast-forwards the first.
 */
function answerCompareJson(base) {
  return jsonResponse({ merge_base_commit: { sha: base } });
}

/** The request URL, whatever shape `fetch` was handed. */
function readRequestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** The bearer token a request carries, whatever shape `fetch` was handed. */
function readToken(input, init) {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const value = headers.get("authorization") ?? "";
  return value.replace(/^(?:token|bearer)\s+/i, "");
}

/** The state viewers' tokens answer their own walk; anyone else gets the fixture's. */
function answerInstallationsWalk(input, init, pathname) {
  const scripted = INBOX.byToken?.[readToken(input, init)];
  if (scripted?.status !== undefined) {
    return jsonResponse({ message: "down (e2e github stub)" }, scripted.status);
  }
  const installations = scripted?.installations ?? INBOX.installations;
  if (pathname === "/user/installations") {
    return jsonResponse({
      total_count: installations.length,
      installations: installations.map((installation) => ({
        id: installation.id,
        account: { login: installation.account },
      })),
    });
  }
  const installationRepos =
    /^\/user\/installations\/(?<id>\d+)\/repositories$/.exec(pathname);
  const installation = installations.find(
    (candidate) => String(candidate.id) === installationRepos.groups.id,
  );
  const repos = installation?.repos ?? [];
  return jsonResponse({
    total_count: repos.length,
    repositories: repos.map((repo) => ({
      id: repo.id,
      full_name: repo.slug,
      permissions: { admin: repo.admin === true },
    })),
  });
}

/** A fixture installation's repository by id, for the gate and the delete's fresh read. */
function findInstallationRepo(id) {
  for (const installation of INBOX.installations) {
    const repo = installation.repos.find(
      (candidate) => String(candidate.id) === id,
    );
    if (repo !== undefined) {
      return repo;
    }
  }
  return undefined;
}

/**
 * The seeded rows carry briefs but no code, and a hover over one reads its
 * span diff ahead of the click, so their heads answer an empty diff rather
 * than a 404 the console would log. Any other unknown head still fails.
 */
function isCodelessHeadCompare(pathname) {
  const compare =
    /^\/repos\/[^/]+\/[^/]+\/compare\/[^.]+\.\.\.(?<head>.+)$/.exec(pathname);
  return compare !== null && CODELESS_HEADS.has(compare.groups.head);
}

/** The Inbox's live read names its query; the conversation read does not. */
function isLiveRead(init) {
  return typeof init?.body === "string" && init.body.includes("query LiveRead");
}

/** The fixture PR's conversation read, the one query that gets threads. */
function isFixtureConversationRead(init) {
  if (
    typeof init?.body !== "string" ||
    !init.body.includes("query PullRequestConversation(")
  ) {
    return false;
  }
  const { owner, repo, prNumber } = JSON.parse(init.body).variables ?? {};
  const isFixtureRepo = `${owner}/${repo}` === REPO_SLUG;
  const isFixturePr = isFixtureRepo && prNumber === FIXTURE_PR_NUMBER;
  return isFixturePr;
}

function buildOutdatedThread({ rootCommentId, anchorSha }) {
  return {
    isResolved: false,
    isOutdated: true,
    path: OUTDATED_THREAD_PATH,
    line: null,
    startLine: null,
    diffSide: "RIGHT",
    startDiffSide: null,
    subjectType: "LINE",
    comments: {
      pageInfo: { hasNextPage: false },
      nodes: [
        {
          fullDatabaseId: String(rootCommentId),
          author: { login: "fixture-reviewer", __typename: "User" },
          body: "This moved since the first revision.",
          createdAt: "2026-01-01T00:00:00Z",
          url: `https://github.com/${REPO_SLUG}/pull/${String(FIXTURE_PR_NUMBER)}#discussion_r${String(rootCommentId)}`,
          pullRequestReview: null,
          originalCommit: { oid: anchorSha },
        },
      ],
    },
  };
}

/**
 * Every alias the live read asked for: a seeded URL row answers with the
 * head the fixture scripts for it (the current one, or one past its brief),
 * anything else is null (not found) so the app marks it unreachable rather
 * than guessing.
 */
function answerLiveRead(init) {
  const { variables } = JSON.parse(init.body);
  const data = {};
  for (const [name, value] of Object.entries(variables)) {
    if (!name.startsWith("n")) {
      continue;
    }
    const index = name.slice(1);
    const slug = `${variables[`o${index}`]}/${variables[`r${index}`]}`;
    const row = INBOX.urlRows.find(
      (candidate) =>
        slug === candidate.slug && Number(value) === candidate.prNumber,
    );
    data[`p${index}`] =
      row === undefined
        ? null
        : {
            databaseId: row.repoId,
            nameWithOwner: row.slug,
            pullRequest: {
              state: "OPEN",
              isDraft: false,
              title: row.title,
              closedAt: null,
              updatedAt: new Date(
                Date.now() - row.updatedMinutesAgo * MINUTE_MS,
              ).toISOString(),
              createdAt: new Date(Date.now() - DAY_MS).toISOString(),
              headRefOid: row.headSha,
              author: { login: row.author },
            },
          };
  }
  return data;
}

globalThis.fetch = async (input, init) => {
  const url = readRequestUrl(input);
  if (!url.startsWith("https://api.github.com")) {
    return realFetch(input, init);
  }
  const { pathname } = new URL(url);
  const isWalk =
    pathname === "/user/installations" ||
    /^\/user\/installations\/\d+\/repositories$/.test(pathname);
  if (isWalk) {
    return answerInstallationsWalk(input, init, pathname);
  }
  if (pathname === `/repositories/${REPO_ID}`) {
    return jsonResponse({
      full_name: REPO_SLUG,
      private: false,
      permissions: { push: false },
    });
  }
  const repository = /^\/repositories\/(?<id>\d+)$/.exec(pathname);
  const installationRepo =
    repository === null
      ? undefined
      : findInstallationRepo(repository.groups.id);
  if (installationRepo !== undefined) {
    return jsonResponse({
      id: installationRepo.id,
      full_name: installationRepo.slug,
      private: false,
      permissions: { push: false, admin: installationRepo.admin === true },
    });
  }
  if (pathname === `/repos/${REPO_SLUG}/pulls`) {
    // The Inbox reads the open list for its stacks; the fixture has none.
    return jsonResponse([]);
  }
  const pull = new RegExp(`^/repos/${REPO_SLUG}/pulls/(?<number>\\d+)$`).exec(
    pathname,
  );
  if (pull?.groups.number === String(FIXTURE_PR_NUMBER)) {
    // The stack read fetches a PR missing from the open list above; the
    // fixture PR answers as one that stands alone.
    return jsonResponse(buildFixturePull(FIXTURE_PR_NUMBER));
  }
  const contents = new RegExp(
    `^/repos/${REPO_SLUG}/contents/(?<path>.+)$`,
  ).exec(pathname);
  if (contents) {
    // A synthetic head file for hunk-edge reads: the landing only needs the
    // line numbers to exist, never the fixture's real source.
    const path = decodeURIComponent(contents.groups.path);
    const text = Array.from(
      { length: SYNTHETIC_FILE_LINES },
      (_, index) => `// ${path} line ${index + 1}`,
    ).join("\n");
    return jsonResponse({
      type: "file",
      name: path.split("/").at(-1),
      path,
      sha: "e2e-synthetic-file",
      size: text.length,
      encoding: "base64",
      content: Buffer.from(text, "utf8").toString("base64"),
    });
  }
  if (isCodelessHeadCompare(pathname)) {
    return new Response("", {
      status: 200,
      headers: {
        "content-type": "application/vnd.github.v3.diff; charset=utf-8",
        date: new Date().toUTCString(),
      },
    });
  }
  const compare = new RegExp(
    `^/repos/${REPO_SLUG}/compare/(?<basehead>.+)$`,
  ).exec(pathname);
  if (compare) {
    const [base = "", head = ""] = compare.groups.basehead.split("...");
    if (!isDiffRequest(input, init)) {
      return answerCompareJson(base);
    }
    const diff =
      loadHeadsDiff(base.slice(0, 8), head.slice(0, 8)) ??
      loadDiff(head.slice(0, 8));
    if (diff === undefined) {
      // Unknown span head = the app compared against the wrong revision,
      // fail loudly, never serve a plausible wrong diff.
      return jsonResponse({ message: "no fixture diff for that head" }, 404);
    }
    return new Response(diff, {
      status: 200,
      headers: {
        "content-type": "application/vnd.github.v3.diff; charset=utf-8",
        date: new Date().toUTCString(),
      },
    });
  }
  if (pathname === "/graphql" && isLiveRead(init)) {
    return jsonResponse({ data: answerLiveRead(init) });
  }
  if (pathname === "/graphql") {
    // The fixture PR's conversation carries the outdated threads the
    // revision jump lands on; every other read is EMPTY. Either way the
    // browser console stays clean (a 404 here logs a resource error).
    const threads = isFixtureConversationRead(init)
      ? OUTDATED_THREADS.map(buildOutdatedThread)
      : [];
    return jsonResponse({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: threads,
            },
            reviews: { pageInfo: { hasNextPage: false }, nodes: [] },
            comments: { pageInfo: { hasNextPage: false }, nodes: [] },
          },
        },
      },
    });
  }
  // Everything else: a clean 404 the web degrades on (expected states),
  // never the real network.
  return jsonResponse({ message: "Not Found (e2e github stub)" }, 404);
};
