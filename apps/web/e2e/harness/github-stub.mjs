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

globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url.startsWith("https://api.github.com")) {
    return realFetch(input, init);
  }
  const { pathname } = new URL(url);
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
      // Unknown span head = the app compared against the wrong revision —
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
