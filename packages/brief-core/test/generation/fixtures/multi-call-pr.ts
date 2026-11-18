import type { Generator } from "generators";
import type { GenerateBriefOptions } from "../../../src/generation/brief/types";
import type { LockfileSummary } from "../../../src/generation/shortened/types";
import type { FetchedPr } from "../../../src/github/types";
import {
  Concerns,
  Roles,
  type ChangeGroup,
  type DetailGeneration,
} from "../../../src/types";
import type { RecordedRequest } from "../../helpers";
import { summarizeTexts } from "../shortened/helpers";

const HUNK_MARKER =
  /\[hunk (f\d+)h(\d+) -> (\S+)\]\n@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g;

export function makeFile(path: string, hunks: number): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    ...Array.from({ length: hunks }, (_, index) => [
      `@@ -${index * 10 + 1},1 +${index * 10 + 1},1 @@`,
      "-old",
      "+new",
    ]).flat(),
    "",
  ].join("\n");
}

function makePnpmLockfile(reactVersion: string): string {
  return [
    "lockfileVersion: '9.0'",
    "packages:",
    `  react@${reactVersion}:`,
    "    resolution: {integrity: sha512-react}",
    "snapshots:",
    `  react@${reactVersion}: {}`,
    "",
  ].join("\n");
}

export const LOCKFILE_DIFF = [
  "diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml",
  "--- a/pnpm-lock.yaml",
  "+++ b/pnpm-lock.yaml",
  "@@ -3,1 +3,1 @@ packages:",
  "-  react@18.2.0:",
  "+  react@18.3.1:",
  "",
].join("\n");

/** f1 and f2 hold 30 hunks each, f3 holds 30, f4 is the lockfile: 90 hunks, two batches. */
export const PATHS = ["src/a.ts", "src/b.ts", "src/c.ts"];
const diff = PATHS.map((path) => makeFile(path, 30)).join("") + LOCKFILE_DIFF;

export const pr: FetchedPr = {
  locator: { owner: "o", repo: "r", number: 7 },
  meta: {
    title: "Large change",
    body: "Touches three files and the lockfile.",
    url: "https://github.com/o/r/pull/7",
    sha: "head0007",
    baseSha: "base0007",
    commitCount: 1,
    files: [
      ...PATHS.map((path) => ({ path, additions: 30, deletions: 30 })),
      { path: "pnpm-lock.yaml", additions: 1, deletions: 1 },
    ],
  },
  diff,
  links: [],
};

const lockfileSummaries = new Map<string, LockfileSummary>();
const lockfileSummary = summarizeTexts(
  "pnpm-lock.yaml",
  makePnpmLockfile("18.2.0"),
  makePnpmLockfile("18.3.1"),
);
if (lockfileSummary !== undefined) {
  lockfileSummaries.set("pnpm-lock.yaml", lockfileSummary);
}

const NO_INTENT = {
  ticketUrls: [],
  ticketTitles: [],
  specificity: "none",
  scopeNote: "",
  items: [],
  alignment: { read: "", goal: "", response: "" },
};

export function makeGroup(id: string): ChangeGroup {
  return {
    id,
    title: `Group ${id}`,
    summary: `What ${id} does.`,
    dominantCategory: "logic-refactor",
    secondaryCategories: [],
    uncertain: false,
    uncertainBetween: [],
  };
}

export const grouping = {
  summary: "Refactors three modules and bumps react.",
  changeGroups: [makeGroup("g1"), makeGroup("g2"), makeGroup("g3")],
  hunkMap: [
    { groupId: "g1", hunks: ["f1"] },
    { groupId: "g2", hunks: ["f2:h1-h30", "f4"] },
    { groupId: "g3", hunks: ["f3"] },
  ],
  readingOrder: [
    { groupId: "g2", why: "the main change" },
    { groupId: "g1", why: "builds on it" },
    { groupId: "g3", why: "side change" },
  ],
  intentCheck: NO_INTENT,
};

/** One core chunk per marker in the request, its ranges read off the hunk header. */
export function answerDetail(
  request: RecordedRequest,
  groupOverride?: string,
): DetailGeneration {
  const chunks = [...request.user.matchAll(HUNK_MARKER)].map(
    (match, position) => {
      const start = Number(match[4]);
      const count = Number(match[5] ?? "1");
      return {
        id: `c${position + 1}`,
        changeGroupId: groupOverride ?? match[3] ?? "",
        file: readPath(request.user, match[1] ?? ""),
        concern: Concerns.IMPLEMENTATION,
        role: Roles.CORE,
        addedRanges: [{ start, end: start + count - 1 }],
        removedRanges: [{ start, end: start + count - 1 }],
        riskSurface: [],
      };
    },
  );
  return { chunks };
}

/** The path a file id names: the `diff --git` header right before its first marker. */
function readPath(user: string, fileId: string): string {
  const marker = user.indexOf(`[hunk ${fileId}h`);
  const header = user.lastIndexOf("diff --git a/", marker);
  const line = user.slice(header, user.indexOf("\n", header));
  return line.replace(/^diff --git a\/(\S+) b\/.*$/, "$1");
}

export function makeAnswer(detailGroupOverride?: string) {
  return (request: RecordedRequest) =>
    request.label === "grouping"
      ? grouping
      : answerDetail(request, detailGroupOverride);
}

export function makeOptions(
  generator: Generator,
  overrides: Partial<GenerateBriefOptions> = {},
): GenerateBriefOptions {
  return {
    pr,
    headIndex: 1,
    commitRange: { base: "base0007", head: "head0007", commitCount: 1 },
    generator,
    forceMultiCall: true,
    multiCallHooks: {},
    lockfileSummaries,
    ...overrides,
  };
}

/** A single-call answer for the same PR: one group, one chunk per file. */
export const singleBrief = {
  summary: "Refactors three modules and bumps react.",
  intentCheck: NO_INTENT,
  changeGroups: [makeGroup("g1")],
  chunks: PATHS.map((path, position) => ({
    id: `c${position + 1}`,
    changeGroupId: "g1",
    file: path,
    concern: "implementation",
    role: "core",
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [{ start: 1, end: 1 }],
    riskSurface: [],
  })),
};
