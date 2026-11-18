// Several scopes in one call is for the Inbox list only. Every other store
// resolves ONE scope through `resolveScope`; this reads the store sources
// and refuses a second file that composes an installation set in either
// spelling this package uses, the drizzle `inArray` or a raw SQL `in`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSourceFile,
  forEachChild,
  isFunctionDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isMethodSignature,
  ScriptTarget,
  type Node,
  type SourceFile,
} from "typescript";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
const STORES_DIR = join(SRC_DIR, "stores");
const MULTI_SCOPE_MARKS = [
  "inArray(pullRequest.installationId",
  "installation_id in (",
  "installationId in (",
];

const WORLD_PREDICATE = "matchesWorld";

/**
 * A place that filters by `matchesWorld`, which in the owner world matches
 * every owner's rows, and the check that makes that safe: `parentCheck` is the
 * call that proves the parent in scope, made inside each `checkedIn` function.
 */
interface WorldSite {
  readonly file: string;
  readonly enclosing: string;
  readonly calls: number;
  readonly parentCheck: string;
  readonly checkedIn: readonly string[];
  readonly reason: string;
}

const REVIEW_SESSION_FILE = "stores/review-session.ts";
const SESSION_OPENERS = [
  "openForWrite",
  "openExistingForWrite",
  "openForPublishRecord",
];
const OPENED_SESSION = {
  file: REVIEW_SESSION_FILE,
  calls: 1,
  parentCheck: "readBriefCarrySliceInScope",
  checkedIn: SESSION_OPENERS,
  reason:
    "the session id comes from a session opened after the brief's scope check, or from previousSession on that brief's facts",
};

const WORLD_SITES: readonly WorldSite[] = [
  {
    file: "stores/generation.ts",
    enclosing: "matchesAttempt",
    calls: 1,
    parentCheck: "matchesChild",
    checkedIn: ["matchesAttempt"],
    reason: "the same predicate semi-joins the attempt's generation row",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "findSession",
    calls: 1,
    parentCheck: "matchesChild",
    checkedIn: ["findSession"],
    reason: "the same query joins the brief under the child predicate",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "hasNewerSession",
    calls: 1,
    parentCheck: "readBriefCarrySliceInScope",
    checkedIn: ["openForWrite", "openExistingForWrite"],
    reason: "facts come from the brief its caller read in scope",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "lockPreviousSession",
    calls: 1,
    parentCheck: "previousSession",
    checkedIn: ["lockPreviousSession"],
    reason: "the id it locks is the one previousSession found",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "lockSession",
    calls: 1,
    parentCheck: "readBriefCarrySliceInScope",
    checkedIn: SESSION_OPENERS,
    reason: "every opener checks key.briefId in its transaction first",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "matchClaimHolders",
    calls: 2,
    parentCheck: "matchesChild",
    checkedIn: ["matchClaimHolders"],
    reason: "the session subquery joins the brief under the child predicate",
  },
  { ...OPENED_SESSION, enclosing: "ownedBy" },
  { ...OPENED_SESSION, enclosing: "ownedDispositions" },
  { ...OPENED_SESSION, enclosing: "ownedReadMarks" },
  { ...OPENED_SESSION, enclosing: "ownedReclassifications" },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "previousSession",
    calls: 1,
    parentCheck: "readBriefCarrySlice",
    checkedIn: ["readPendingFacts", "preview", "readBriefCarrySliceInScope"],
    reason: "facts come from a brief read in scope, and it filters on that PR",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "previousWork",
    calls: 4,
    parentCheck: "previousSession",
    checkedIn: ["preview", "lockPreviousSession"],
    reason: "the session id is the one previousSession found",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "setOutcome",
    calls: 1,
    parentCheck: "runSessionOperation",
    checkedIn: ["setOutcome"],
    reason: "the session id comes from the session the operation opened",
  },
  {
    file: REVIEW_SESSION_FILE,
    enclosing: "snapshotFor",
    calls: 5,
    parentCheck: "findSession",
    checkedIn: ["snapshotFor"],
    reason: "the session id is the one findSession found",
  },
];

function readSourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".ts"));
}

function readFunctionName(node: Node): string | undefined {
  if (isFunctionDeclaration(node) || isMethodDeclaration(node)) {
    return node.name?.getText();
  }
  return undefined;
}

/** The interface member and the two scopes' implementations, not a use. */
function isPredicateDeclaration(node: Node): boolean {
  const { parent } = node;
  const declares = isMethodSignature(parent) || isMethodDeclaration(parent);
  return declares && parent.name === node;
}

function parseSource(file: string): SourceFile {
  const source = readFileSync(join(SRC_DIR, file), "utf8");
  return createSourceFile(file, source, ScriptTarget.Latest, true);
}

/** Every use of the predicate, a destructure or an alias included. */
function collectWorldUses(file: string): string[] {
  const uses: string[] = [];

  function visit(node: Node, enclosing: string): void {
    const usesPredicate =
      isIdentifier(node) &&
      node.text === WORLD_PREDICATE &&
      !isPredicateDeclaration(node);
    if (usesPredicate) {
      uses.push(`${file} ${enclosing}`);
    }
    const name = readFunctionName(node) ?? enclosing;
    forEachChild(node, (child) => {
      visit(child, name);
    });
  }
  visit(parseSource(file), "module");

  return uses;
}

function readFunctionTexts(file: string): Map<string, string> {
  const texts = new Map<string, string>();

  function visit(node: Node): void {
    const name = readFunctionName(node);
    if (name !== undefined) {
      texts.set(name, node.getText());
    }
    forEachChild(node, visit);
  }
  visit(parseSource(file));

  return texts;
}

function formatSiteCounts(uses: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const use of uses) {
    counts.set(use, (counts.get(use) ?? 0) + 1);
  }
  return [...counts].map(([site, calls]) => `${site} x${calls}`).toSorted();
}

function formatAllowedSite(site: WorldSite): string {
  return `${site.file} ${site.enclosing} x${site.calls}`;
}

describe("multi-scope reads", () => {
  it("only the Inbox store composes several installations", () => {
    const composing = readdirSync(STORES_DIR, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".ts"))
      .filter((name) => {
        const source = readFileSync(join(STORES_DIR, name), "utf8");
        return MULTI_SCOPE_MARKS.some((mark) => source.includes(mark));
      });

    expect(composing).toEqual(["inbox.ts"]);
  });
});

describe("owner-world reads that trust a parent check", () => {
  it("a matchesWorld use is listed with the parent check it relies on", () => {
    const uses = readSourceFiles().flatMap(collectWorldUses);

    expect(formatSiteCounts(uses)).toEqual(
      WORLD_SITES.map(formatAllowedSite).toSorted(),
    );
  });

  it.each(WORLD_SITES.map((site) => [formatAllowedSite(site), site] as const))(
    "%s names a check its checkers still make",
    (_label, site) => {
      const texts = readFunctionTexts(site.file);

      expect(site.parentCheck).not.toBe(WORLD_PREDICATE);
      for (const checker of site.checkedIn) {
        expect(texts.get(checker)).toContain(`${site.parentCheck}(`);
      }
    },
  );
});
