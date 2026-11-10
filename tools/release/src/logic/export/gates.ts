import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { GITLEAKS_CONFIG, GITLEAKS_IMAGE, RELEASES_DIR } from "../../consts";
import type { CommandRunner, GitPort } from "../../types";
import { checkReleases } from "../check";
import { checkTreeLinks } from "./link-check";
import { formatLinkHit, formatMissingRepository } from "./report";
import {
  type GateContext,
  type GateDeps,
  type GateName,
  GateNames,
  type GateOutcome,
  type GateRun,
  type GateVerdict,
} from "./types";

// gitleaks exits 1 on its own fatal errors, so findings get a code of their
// own; docker itself uses 125 to 127.
const GITLEAKS_FOUND_EXIT = 99;
const GITLEAKS_ERROR_EXIT = 1;
const SCAN_MOUNT = "/scan";
/** Opens a gzipped eval fixture; a nested archive stays closed. */
const GITLEAKS_ARCHIVE_DEPTH = 1;
/**
 * gitleaks exits 0 when it cannot read a file and only logs it at ERR, so
 * an ERR line means the scan did not cover the tree. Anchored on the
 * `--no-color` level token, never a bare substring.
 */
const GITLEAKS_ERROR_LINE = /^\d{1,2}:\d{2}(?:AM|PM) ERR .*$/gm;

/** Each step runs with the scratch copy as cwd; the copy's one commit is the baseline base. */
const BUILD_STEPS = [
  ["install", "--frozen-lockfile"],
  ["lint"],
  ["-r", "typecheck"],
  ["-C", "tools/categorizer", "test"],
] as const;
const BUILD_ENV = { MERGEBRIEF_BASELINE_BASE: "HEAD" } as const;

function formatCountedNoun(count: number, one: string, other: string): string {
  const noun = count === 1 ? one : other;
  return `${count} ${noun}`;
}

function passGate(
  summary: string,
  notices: readonly string[] = [],
): GateOutcome {
  return { ok: true, value: { summary, notices } };
}

function failGate(
  reason: string,
  details: readonly string[] = [],
): GateOutcome {
  return { ok: false, error: { reason, details } };
}

/** No shipped markdown sends a reader into an excluded path. */
export function checkPathsGate(context: GateContext): GateOutcome {
  const hits = checkTreeLinks(context.dir, context.shipped);
  if (hits.length > 0) {
    const lines = formatCountedNoun(
      hits.length,
      "shipped markdown line names an excluded path",
      "shipped markdown lines name excluded paths",
    );
    return failGate(lines, hits.map(formatLinkHit));
  }
  const files = formatCountedNoun(context.shipped.length, "file", "files");
  return passGate(`${files}, no internal links`);
}

/** The scanner's argv; the tree's own allowlist applies when the tree ships one. */
function buildSecretsScanArgs(context: GateContext): string[] {
  const args = [
    "run",
    "--rm",
    "--mount",
    `type=bind,source=${context.dir},target=${SCAN_MOUNT},readonly`,
    GITLEAKS_IMAGE,
    "dir",
    SCAN_MOUNT,
  ];
  if (context.shipped.includes(GITLEAKS_CONFIG)) {
    args.push("--config", `${SCAN_MOUNT}/${GITLEAKS_CONFIG}`);
  }
  args.push(
    "--no-banner",
    "--no-color",
    "--redact",
    "--verbose",
    "--max-archive-depth",
    String(GITLEAKS_ARCHIVE_DEPTH),
    "--exit-code",
    String(GITLEAKS_FOUND_EXIT),
  );
  return args;
}

/** gitleaks over the tree as a read-only bind mount, which fails when the daemon cannot see the source; any finding or unread file fails. */
export function scanSecretsGate(
  context: GateContext,
  runner: CommandRunner,
): GateOutcome {
  const ran = runner.runCapturingStderr({
    command: "docker",
    args: buildSecretsScanArgs(context),
    cwd: context.dir,
  });
  if (!ran.ok) {
    return failGate(`${ran.error}; the gitleaks gate needs Docker`);
  }

  const { status, stderr } = ran.value;
  if (status === GITLEAKS_FOUND_EXIT) {
    return failGate(
      "gitleaks found secrets in the tree; its findings are above, redacted",
    );
  }
  if (status === GITLEAKS_ERROR_EXIT) {
    return failGate("gitleaks could not complete the scan; its error is above");
  }
  if (status !== 0) {
    return failGate(`docker run exited ${status} before gitleaks reported`);
  }

  const unreadLines = stderr.match(GITLEAKS_ERROR_LINE) ?? [];
  if (unreadLines.length > 0) {
    return failGate(
      "gitleaks could not read every file; the ERR lines are above",
      unreadLines,
    );
  }
  return passGate("no secrets found");
}

/**
 * The tree's notes file for the version, and the public repo's answer. The
 * gate places nothing: release.yml places the tag when it publishes. Until
 * that repo exists a dry run reads it as holding no tags; a publish or an emit refuses.
 */
export function checkNotesGate(
  context: GateContext,
  git: GitPort,
): GateOutcome {
  const { slug, url } = context.publicRepository;
  const tags = git.listPublicTags(url);
  const notices: string[] = [];
  if (tags === undefined) {
    if (context.requiresPublicRepository) {
      return failGate(formatMissingRepository(context.publicRepository));
    }
    notices.push(
      `public repo ${slug} not found; treating as no releases (dry run only)`,
    );
  }

  const tag = `v${context.version}`;
  const checked = checkReleases(join(context.dir, RELEASES_DIR), tag);
  if (!checked.ok) {
    const details = checked.error.map(
      (error) => `${relative(context.dir, error.path)}: ${error.reason}`,
    );
    return failGate(`release check refused ${tag}`, details);
  }
  const held = formatCountedNoun(tags?.length ?? 0, "tag", "tags");
  return passGate(
    `${tag} has its notes file; public repo ${slug} holds ${held}`,
    notices,
  );
}

/**
 * Install, lint, typecheck and the categorizer suite over a scratch copy of
 * the tree, so the tree itself never gains build output. The copy is one
 * commit, which is what the git-reading lint gates need.
 */
export function runBuildGate(
  context: GateContext,
  deps: GateDeps,
): GateOutcome {
  const copyPrefix = join(tmpdir(), "mergebrief-export-build-");
  const copy = mkdtempSync(copyPrefix);
  try {
    cpSync(context.dir, copy, { recursive: true, verbatimSymlinks: true });
    deps.git.commitScratchRepo(copy);

    for (const args of BUILD_STEPS) {
      const label = `pnpm ${args.join(" ")}`;
      const ran = deps.runner.run({
        command: "pnpm",
        args,
        cwd: copy,
        env: BUILD_ENV,
      });
      if (!ran.ok) {
        return failGate(ran.error);
      }
      if (ran.value !== 0) {
        return failGate(`${label} exited ${ran.value}`);
      }
    }
    return passGate(`${BUILD_STEPS.length} steps passed in a scratch copy`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

interface Gate {
  readonly name: GateName;
  readonly run: (context: GateContext, deps: GateDeps) => GateOutcome;
}

const GATES: readonly Gate[] = [
  { name: GateNames.PATHS, run: (context) => checkPathsGate(context) },
  {
    name: GateNames.GITLEAKS,
    run: (context, deps) => scanSecretsGate(context, deps.runner),
  },
  {
    name: GateNames.NOTES,
    run: (context, deps) => checkNotesGate(context, deps.git),
  },
  { name: GateNames.BUILD, run: runBuildGate },
];

/** The gates in their fixed order; the first failure stops the run. */
export function runGates(
  context: GateContext,
  deps: GateDeps,
  onVerdict: (verdict: GateVerdict) => void,
): GateRun {
  const verdicts: GateVerdict[] = [];
  for (const gate of GATES) {
    const verdict: GateVerdict = {
      name: gate.name,
      outcome: gate.run(context, deps),
    };
    verdicts.push(verdict);
    onVerdict(verdict);
    if (!verdict.outcome.ok) {
      return { verdicts, passed: false };
    }
  }
  return { verdicts, passed: true };
}
