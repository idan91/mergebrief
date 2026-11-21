// PROTOTYPE (BRIEF-381 held display). Throwaway: mock unmetConditions shaped
// like the settled wire item, English copy inline on purpose.

export type Source = "repo" | "instance";
export type BotName = "unblocked" | "coderabbit" | "claude" | "greptile" | "copilot";
export type BotState =
  | "not-started"
  | "running"
  | "not-approved"
  | "issues"
  | "no-verdict"
  | "permission";

export interface BotCondition {
  kind: "bots";
  bot: BotName;
  wants: "finished" | "approved" | "clean";
  state: BotState;
  issues?: number;
  source: Source;
}
export interface CiCondition {
  kind: "ci";
  failed: string[];
  running: string[];
  missing: string[];
  permission?: boolean;
  source: Source;
}
export interface ReadyCondition {
  kind: "ready-for-review";
  source: Source;
}
export interface SizeCondition {
  kind: "size";
  measure: "changedLines" | "additions" | "deletions";
  bound: "min" | "max";
  limit: number;
  actual: number;
  source: Source;
}
export interface LabelsCondition {
  kind: "labels";
  missing: string[];
  source: Source;
}
export interface BaseCondition {
  kind: "base";
  base: string;
  allowed: string[];
  source: Source;
}
export type PlainCondition =
  | BotCondition
  | CiCondition
  | ReadyCondition
  | SizeCondition
  | LabelsCondition
  | BaseCondition;
export interface AnyCondition {
  kind: "any";
  conditions: PlainCondition[];
  source: Source;
}
export type UnmetCondition = PlainCondition | AnyCondition;

export interface HeldCase {
  id: string;
  label: string;
  title: string;
  repo: string;
  prNumber: number;
  author: string;
  sha: string;
  previousSha?: string;
  draft: boolean;
  unmet: UnmetCondition[];
}

export const BOT_NAMES: Record<BotName, string> = {
  unblocked: "Unblocked",
  coderabbit: "CodeRabbit",
  claude: "Claude Code Review",
  greptile: "Greptile",
  copilot: "Copilot",
};

export const HELD_CASES: HeldCase[] = [
  {
    id: "waits",
    label: "Waits only",
    title: "Retry webhook deliveries with jittered backoff",
    repo: "northwind/ingest",
    prNumber: 1482,
    author: "maya-okafor",
    sha: "3f9c2ab",
    draft: false,
    unmet: [
      { kind: "bots", bot: "coderabbit", wants: "finished", state: "running", source: "repo" },
      {
        kind: "ci",
        failed: [],
        running: ["build", "e2e", "lint", "typecheck", "unit (node 22)", "unit (node 24)"],
        missing: [],
        source: "repo",
      },
    ],
  },
  {
    id: "blocked",
    label: "Blockers only",
    title: "Move billing exports to the new ledger tables",
    repo: "northwind/billing",
    prNumber: 377,
    author: "tomas-reyes",
    sha: "b71e04d",
    draft: false,
    unmet: [
      { kind: "size", measure: "changedLines", bound: "max", limit: 800, actual: 1284, source: "repo" },
      { kind: "labels", missing: ["needs-brief"], source: "repo" },
    ],
  },
  {
    id: "mixed",
    label: "Waits and blockers",
    title: "Session store: drop the Redis fallback",
    repo: "northwind/api",
    prNumber: 2210,
    author: "lena-brandt",
    sha: "9ad3317",
    draft: false,
    unmet: [
      { kind: "bots", bot: "claude", wants: "clean", state: "issues", issues: 3, source: "repo" },
      { kind: "ci", failed: ["test", "lint"], running: ["e2e"], missing: [], source: "repo" },
      { kind: "size", measure: "changedLines", bound: "max", limit: 1500, actual: 2046, source: "instance" },
    ],
  },
  {
    id: "any",
    label: "Any group",
    title: "Typed config loader for workers",
    repo: "northwind/platform",
    prNumber: 918,
    author: "priya-nair",
    sha: "e40c9b2",
    draft: false,
    unmet: [
      { kind: "ci", failed: [], running: [], missing: ["deploy-preview"], source: "repo" },
      {
        kind: "any",
        source: "repo",
        conditions: [
          { kind: "bots", bot: "coderabbit", wants: "approved", state: "not-approved", source: "repo" },
          { kind: "size", measure: "changedLines", bound: "max", limit: 500, actual: 1284, source: "repo" },
        ],
      },
    ],
  },
  {
    id: "draft",
    label: "Held draft",
    title: "Spike: stream diffs into the brief worker",
    repo: "northwind/ingest",
    prNumber: 1490,
    author: "maya-okafor",
    sha: "c2f8a61",
    draft: true,
    unmet: [
      { kind: "ready-for-review", source: "instance" },
      { kind: "bots", bot: "greptile", wants: "finished", state: "not-started", source: "repo" },
    ],
  },
  {
    id: "permission",
    label: "Permission missing",
    title: "Rate-limit the public search endpoint",
    repo: "northwind/api",
    prNumber: 2214,
    author: "dev-amari",
    sha: "41b0e9c",
    draft: false,
    unmet: [
      { kind: "bots", bot: "unblocked", wants: "finished", state: "permission", source: "instance" },
      { kind: "ci", failed: [], running: [], missing: [], permission: true, source: "instance" },
    ],
  },
  {
    id: "behind",
    label: "Held behind a brief",
    title: "Inbox: keep the cursor row on refresh",
    repo: "northwind/web",
    prNumber: 3307,
    author: "lena-brandt",
    sha: "77d1c0e",
    previousSha: "a81d0e4",
    draft: false,
    unmet: [
      { kind: "bots", bot: "unblocked", wants: "finished", state: "running", source: "repo" },
    ],
  },
];

export const PROTO_REPO_ID = "proto-held";

export function findCase(id: string): HeldCase {
  return HELD_CASES.find((held) => held.id === id) ?? HELD_CASES[0]!;
}

export function findCaseByNumber(prNumber: number): HeldCase | undefined {
  return HELD_CASES.find((held) => held.prNumber === prNumber);
}

const NUMBER = new Intl.NumberFormat("en");
const CHECK_NAMES_SHOWN = 3;

function listChecks(names: string[], cap: number | undefined): string {
  const shown = cap === undefined ? names : names.slice(0, cap);
  const rest = names.length - shown.length;
  const joined = shown.join(", ");
  if (rest > 0) {
    return `${joined} and ${String(rest)} more`;
  }
  return joined;
}

export function describeOwner(source: Source): string {
  return source === "repo" ? "this repository" : "this MergeBrief instance";
}

export function describeOwnerShort(source: Source): string {
  return source === "repo" ? "Repository" : "Instance";
}

const MEASURES: Record<SizeCondition["measure"], string> = {
  changedLines: "changed lines",
  additions: "added lines",
  deletions: "deleted lines",
};

/** The Entry's wording, one line per state; `cap` trims check names. */
export function describeCondition(
  condition: PlainCondition,
  cap: number | undefined = CHECK_NAMES_SHOWN,
): string[] {
  switch (condition.kind) {
    case "bots":
      return [describeBot(condition)];
    case "ci":
      return describeCi(condition, cap);
    case "ready-for-review":
      return ["Needs this pull request marked ready for review"];
    case "size": {
      const word = condition.bound === "max" ? "over the" : "under the";
      const edge = condition.bound === "max" ? "maximum" : "minimum";
      return [
        `${NUMBER.format(condition.actual)} ${MEASURES[condition.measure]}, ${word} ${NUMBER.format(condition.limit)} ${edge}`,
      ];
    }
    case "labels":
      return [`Needs the label ${condition.missing.join(", ")}`];
    case "base":
      return [`Targets ${condition.base}, not ${condition.allowed.join(" or ")}`];
  }
}

function describeBot(condition: BotCondition): string {
  const name = BOT_NAMES[condition.bot];
  switch (condition.state) {
    case "not-started":
      return `Waiting for ${name} to start on this push`;
    case "running":
      return `Waiting for ${name} to finish`;
    case "not-approved":
      return `${name} finished without approving`;
    case "issues":
      return `${name} found ${String(condition.issues ?? 0)} issues`;
    case "no-verdict":
      return `${name} gave no verdict on this push`;
    case "permission":
      return `Can't check ${name} until this installation accepts MergeBrief's Checks and Commit statuses permissions`;
  }
}

function describeCi(condition: CiCondition, cap: number | undefined): string[] {
  if (condition.permission === true) {
    return ["Can't check CI until this installation accepts MergeBrief's Checks and Commit statuses permissions"];
  }
  const lines: string[] = [];
  if (condition.failed.length > 0) {
    lines.push(`CI failed: ${listChecks(condition.failed, cap)}`);
  }
  if (condition.running.length > 0) {
    lines.push(`Waiting for CI: ${listChecks(condition.running, cap)} still running`);
  }
  if (condition.missing.length > 0) {
    const verb = condition.missing.length === 1 ? "has" : "have";
    lines.push(`Waiting for CI: ${listChecks(condition.missing, cap)} ${verb} not reported on this push`);
  }
  return lines;
}

/** A few words for the inbox row's end. */
export function describeConditionShort(condition: UnmetCondition): string {
  switch (condition.kind) {
    case "any":
      return `Needs one of ${String(condition.conditions.length)}`;
    case "bots":
      return describeBotShort(condition);
    case "ci":
      if (condition.permission === true) {
        return "Needs a permission";
      }
      return condition.failed.length > 0 ? "CI failed" : "Waiting for CI";
    case "ready-for-review":
      return "Not ready for review";
    case "size":
      return condition.bound === "max" ? "Over the size limit" : "Under the size limit";
    case "labels":
      return "Missing a label";
    case "base":
      return "Other base branch";
  }
}

function describeBotShort(condition: BotCondition): string {
  const name = BOT_NAMES[condition.bot];
  switch (condition.state) {
    case "not-started":
    case "running":
      return `Waiting for ${name}`;
    case "not-approved":
      return `${name} not approved`;
    case "issues":
      return `${name}: ${String(condition.issues ?? 0)} issues`;
    case "no-verdict":
      return `${name}: no verdict`;
    case "permission":
      return "Needs a permission";
  }
}

/**
 * Resolves by itself (a bot or CI still working) versus needs someone to act
 * (a push, a label, a click, an operator). Decided by the state, not the kind.
 */
export function isWait(condition: UnmetCondition): boolean {
  switch (condition.kind) {
    case "bots":
      return condition.state === "not-started" || condition.state === "running";
    case "ci":
      return condition.permission !== true && condition.failed.length === 0;
    case "any":
      return condition.conditions.some(isWait);
    default:
      return false;
  }
}

/** Waits first, then blockers; the any group last, as the Entry orders it. */
export function sortConditions(unmet: UnmetCondition[]): UnmetCondition[] {
  const plain = unmet.filter((condition) => condition.kind !== "any");
  const groups = unmet.filter((condition) => condition.kind === "any");
  const waits = plain.filter(isWait);
  const blockers = plain.filter((condition) => !isWait(condition));
  return [...waits, ...blockers, ...groups];
}

function describeWaitClause(condition: UnmetCondition): string | undefined {
  if (condition.kind === "bots") {
    return `${BOT_NAMES[condition.bot]} finishes`;
  }
  if (condition.kind === "ci") {
    return "CI passes";
  }
  return undefined;
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) {
    return clauses.join("");
  }
  return `${clauses.slice(0, -1).join(", ")} and ${clauses.at(-1) ?? ""}`;
}

/** Direction C's lead line. */
export function composeSentence(unmet: UnmetCondition[]): { lead: string; blocked: boolean } {
  const blockers = unmet.filter((condition) => !isWait(condition));
  if (blockers.length > 0) {
    return { lead: "This push won't generate a brief by itself.", blocked: true };
  }
  const clauses = unmet
    .map(describeWaitClause)
    .filter((clause): clause is string => clause !== undefined);
  return { lead: `Generates a brief when ${joinClauses(clauses)}.`, blocked: false };
}
