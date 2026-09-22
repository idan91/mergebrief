// Fetch-level GitHub stub for the e2e server process (loaded via
// NODE_OPTIONS --import). Everything the suite needs from api.github.com is
// served from the committed fixtures; anything else answers 404 so a new
// GitHub dependency fails loudly instead of hitting the network.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_DIR = process.env.MERGEBRIEF_E2E_FIXTURES;
const REPO_ID = process.env.MERGEBRIEF_E2E_REPO_ID ?? "424242";
const REPO_SLUG =
  process.env.MERGEBRIEF_E2E_REPO_SLUG ?? "mergebrief/e2e-fixture";
const INBOX = JSON.parse(
  process.env.MERGEBRIEF_E2E_INBOX ?? '{"installations":[],"urlRows":[]}',
);
const MINUTE_MS = 60_000;
const realFetch = globalThis.fetch;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
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
  const entries = JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8"));
  return entries.map((entry) => entry.patch).join("\n");
}

/** The request URL, whatever shape `fetch` was handed. */
function readRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
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
    repositories: repos.map((repo) => ({ id: repo.id, full_name: repo.slug })),
  });
}

/** The Inbox's live read names its query; the conversation read does not. */
function isLiveRead(init) {
  return typeof init?.body === "string" && init.body.includes("query LiveRead");
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
    if (!name.startsWith("n")) continue;
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
              headRefOid: row.headSha,
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
  const compare = new RegExp(
    `^/repos/${REPO_SLUG}/compare/(?<basehead>.+)$`,
  ).exec(pathname);
  if (compare) {
    const head = compare.groups.basehead.split("...")[1] ?? "";
    const diff = loadDiff(head.slice(0, 8));
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
    // An EMPTY conversation: the section renders its no-threads state and
    // the browser console stays clean (a 404 here logs a resource error).
    return jsonResponse({
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [],
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
