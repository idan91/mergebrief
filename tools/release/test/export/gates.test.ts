import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GITLEAKS_CONFIG, GITLEAKS_IMAGE } from "../../src/consts";
import { createCommandRunner } from "../../src/logic/command-runner";
import {
  checkNotesGate,
  checkPathsGate,
  runBuildGate,
  runGates,
  scanSecretsGate,
} from "../../src/logic/export/gates";
import {
  type GateContext,
  GateNames,
  type PublicRepository,
} from "../../src/logic/export/types";
import {
  makeNotesFile,
  makeTempRoot,
  stubCapturingRunner,
  stubCommandRunner,
  stubGitPort,
  type Tree,
  writeTree,
} from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const PUBLIC: PublicRepository = {
  slug: "Idan91/mergebrief",
  url: "https://github.com/Idan91/mergebrief.git",
};

const CLEAN_TREE: Tree = {
  "README.md": "Read [the guide](docs/guide.md).\n",
  "docs/guide.md": "Plain.\n",
  "docs/releases/0.1.0-rc.1.md": makeNotesFile({}, "First candidate.\n"),
};

function makeContext(tree: Tree, overrides: Partial<GateContext> = {}) {
  const dir = makeTempRoot();
  made.push(dir);
  writeTree(dir, tree);
  const context: GateContext = {
    dir,
    version: "0.1.0-rc.1",
    shipped: Object.keys(tree),
    requiresPublicRepository: false,
    publicRepository: PUBLIC,
    ...overrides,
  };
  return context;
}

describe("the paths gate", () => {
  it("passes a tree whose markdown names no excluded path", () => {
    const outcome = checkPathsGate(makeContext(CLEAN_TREE));

    expect(outcome).toEqual({
      ok: true,
      value: { summary: "3 files, no internal links", notices: [] },
    });
  });

  it("fails with one file and line per internal link", () => {
    const context = makeContext({
      ...CLEAN_TREE,
      "docs/guide.md": "Plain.\n\nSee [the ADR](internal/adr.md).\n",
    });

    expect(checkPathsGate(context)).toEqual({
      ok: false,
      error: {
        reason: "1 shipped markdown line names an excluded path",
        details: ["docs/guide.md:3: link to internal/adr.md"],
      },
    });
  });
});

describe("the gitleaks gate", () => {
  it("scans the tree read-only with the pinned image", () => {
    const context = makeContext(CLEAN_TREE);
    const recorded = stubCapturingRunner();

    const outcome = scanSecretsGate(context, recorded.runner);

    expect(outcome.ok).toBe(true);
    expect(recorded.specs).toEqual([
      {
        command: "docker",
        args: [
          "run",
          "--rm",
          "--mount",
          `type=bind,source=${context.dir},target=/scan,readonly`,
          GITLEAKS_IMAGE,
          "dir",
          "/scan",
          "--no-banner",
          "--no-color",
          "--redact",
          "--verbose",
          "--max-archive-depth",
          "1",
          "--exit-code",
          "99",
        ],
        cwd: context.dir,
      },
    ]);
  });

  it("reads the allowlist the tree ships", () => {
    const context = makeContext({
      ...CLEAN_TREE,
      [GITLEAKS_CONFIG]: "[extend]\nuseDefault = true\n",
    });
    const recorded = stubCapturingRunner();

    scanSecretsGate(context, recorded.runner);

    expect(recorded.specs[0]?.args).toEqual([
      "run",
      "--rm",
      "--mount",
      `type=bind,source=${context.dir},target=/scan,readonly`,
      GITLEAKS_IMAGE,
      "dir",
      "/scan",
      "--config",
      `/scan/${GITLEAKS_CONFIG}`,
      "--no-banner",
      "--no-color",
      "--redact",
      "--verbose",
      "--max-archive-depth",
      "1",
      "--exit-code",
      "99",
    ]);
  });

  it("fails when gitleaks reports a secret", () => {
    const recorded = stubCapturingRunner([
      { ok: true, value: { status: 99, stderr: "" } },
    ]);

    const outcome = scanSecretsGate(makeContext(CLEAN_TREE), recorded.runner);

    expect(!outcome.ok && outcome.error.reason).toBe(
      "gitleaks found secrets in the tree; its findings are above, redacted",
    );
  });

  it("tells a gitleaks error apart from a finding", () => {
    const recorded = stubCapturingRunner([
      { ok: true, value: { status: 1, stderr: "" } },
    ]);

    const outcome = scanSecretsGate(makeContext(CLEAN_TREE), recorded.runner);

    expect(!outcome.ok && outcome.error.reason).toBe(
      "gitleaks could not complete the scan; its error is above",
    );
  });

  it("fails naming Docker when the scanner cannot run", () => {
    const recorded = stubCapturingRunner([
      { ok: false, error: "docker could not start: spawn docker ENOENT" },
    ]);
    const exited = stubCapturingRunner([
      { ok: true, value: { status: 125, stderr: "" } },
    ]);

    const outcome = scanSecretsGate(makeContext(CLEAN_TREE), recorded.runner);
    const broken = scanSecretsGate(makeContext(CLEAN_TREE), exited.runner);

    expect(!outcome.ok && outcome.error.reason).toBe(
      "docker could not start: spawn docker ENOENT; the gitleaks gate needs Docker",
    );
    expect(!broken.ok && broken.error.reason).toBe(
      "docker run exited 125 before gitleaks reported",
    );
  });
  it("fails when gitleaks logs a file it could not read", () => {
    const unread =
      '1:06AM ERR error="could not read file: brotli: PADDING_2" path=/scan/a.brief.json';
    const recorded = stubCapturingRunner([
      {
        ok: true,
        value: { status: 0, stderr: `1:06AM INF scanned\n${unread}\n` },
      },
    ]);

    const outcome = scanSecretsGate(makeContext(CLEAN_TREE), recorded.runner);

    expect(outcome).toEqual({
      ok: false,
      error: {
        reason: "gitleaks could not read every file; the ERR lines are above",
        details: [unread],
      },
    });
  });

  it("reads only a log line's level token as an error", () => {
    const recorded = stubCapturingRunner([
      {
        ok: true,
        value: {
          status: 0,
          stderr: "File:        notes/ERR log.md\n10:41PM INF no leaks found\n",
        },
      },
    ]);

    const outcome = scanSecretsGate(makeContext(CLEAN_TREE), recorded.runner);

    expect(outcome.ok).toBe(true);
  });

  it("reports findings ahead of an unread file", () => {
    const recorded = stubCapturingRunner([
      {
        ok: true,
        value: { status: 99, stderr: "9:00AM ERR error=x path=/scan/y\n" },
      },
    ]);

    const outcome = scanSecretsGate(makeContext(CLEAN_TREE), recorded.runner);

    expect(!outcome.ok && outcome.error.reason).toBe(
      "gitleaks found secrets in the tree; its findings are above, redacted",
    );
  });
});

describe("the notes gate", () => {
  it("reads the notes file and counts the public repo's tags", () => {
    const urls: string[] = [];
    const git = stubGitPort({
      listPublicTags: (url) => {
        urls.push(url);
        return ["v0.0.9"];
      },
    });

    const outcome = checkNotesGate(makeContext(CLEAN_TREE), git);

    expect(urls).toEqual([PUBLIC.url]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        summary:
          "v0.1.0-rc.1 has its notes file; public repo Idan91/mergebrief holds 1 tag",
        notices: [],
      },
    });
  });

  it("treats a missing public repo as no releases in a dry run", () => {
    const git = stubGitPort({ listPublicTags: () => undefined });

    const outcome = checkNotesGate(makeContext(CLEAN_TREE), git);

    expect(outcome.ok && outcome.value.notices).toEqual([
      "public repo Idan91/mergebrief not found; treating as no releases (dry run only)",
    ]);
  });

  it("refuses a missing public repo when publishing", () => {
    const git = stubGitPort({ listPublicTags: () => undefined });
    const context = makeContext(CLEAN_TREE, { requiresPublicRepository: true });

    expect(checkNotesGate(context, git)).toEqual({
      ok: false,
      error: {
        reason: "public repo Idan91/mergebrief not found; a publish needs it",
        details: [],
      },
    });
  });

  it("refuses a version whose notes file the tree lacks", () => {
    const context = makeContext(CLEAN_TREE, { version: "0.1.0" });

    const outcome = checkNotesGate(context, stubGitPort());

    expect(outcome).toEqual({
      ok: false,
      error: {
        reason: "release check refused v0.1.0",
        details: ["docs/releases/0.1.0.md: no notes file for tag v0.1.0"],
      },
    });
  });
});

describe("the build gate", () => {
  it("runs the build in a committed scratch copy of the tree", () => {
    const context = makeContext(CLEAN_TREE);
    const committed: string[] = [];
    const seenReadme: string[] = [];
    const git = stubGitPort({
      commitScratchRepo: (dir) => {
        committed.push(dir);
      },
    });
    const recorded = stubCommandRunner([], (spec) => {
      const readmePath = join(spec.cwd, "README.md");
      seenReadme.push(readFileSync(readmePath, "utf8"));
    });

    const outcome = runBuildGate(context, { git, runner: recorded.runner });

    const copy = committed[0] ?? "";
    expect(outcome.ok && outcome.value.summary).toBe(
      "4 steps passed in a scratch copy",
    );
    expect(recorded.specs.map((spec) => spec.args.join(" "))).toEqual([
      "install --frozen-lockfile",
      "lint",
      "-r typecheck",
      "-C tools/categorizer test",
    ]);
    expect(copy).not.toBe(context.dir);
    expect(recorded.specs.every((spec) => spec.cwd === copy)).toBe(true);
    expect(recorded.specs[0]?.env).toEqual({
      MERGEBRIEF_BASELINE_BASE: "HEAD",
    });
    expect(seenReadme).toHaveLength(4);
    expect(existsSync(copy)).toBe(false);
    const readmePath = join(context.dir, "README.md");
    expect(existsSync(readmePath)).toBe(true);
  });

  it("stops at the first step that fails and names it", () => {
    const recorded = stubCommandRunner([
      { ok: true, value: 0 },
      { ok: true, value: 1 },
    ]);

    const outcome = runBuildGate(makeContext(CLEAN_TREE), {
      git: stubGitPort(),
      runner: recorded.runner,
    });

    expect(!outcome.ok && outcome.error.reason).toBe("pnpm lint exited 1");
    expect(recorded.specs).toHaveLength(2);
  });
});

describe("running the gates", () => {
  it("runs every gate in order and passes when all pass", () => {
    const names: string[] = [];
    const recorded = stubCommandRunner();

    const run = runGates(
      makeContext(CLEAN_TREE),
      { git: stubGitPort(), runner: recorded.runner },
      (verdict) => names.push(verdict.name),
    );

    expect(names).toEqual([
      GateNames.PATHS,
      GateNames.GITLEAKS,
      GateNames.NOTES,
      GateNames.BUILD,
    ]);
    expect(run.passed).toBe(true);
  });

  it("stops at the first failing gate", () => {
    const recorded = stubCapturingRunner([
      { ok: true, value: { status: 1, stderr: "" } },
    ]);

    const run = runGates(
      makeContext(CLEAN_TREE),
      { git: stubGitPort(), runner: recorded.runner },
      () => undefined,
    );

    expect(run.verdicts.map((verdict) => verdict.name)).toEqual([
      GateNames.PATHS,
      GateNames.GITLEAKS,
    ]);
    expect(run.passed).toBe(false);
    expect(recorded.specs).toHaveLength(1);
  });
});

const TOKEN_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const TOKEN_LENGTH = 36;
const DOCKER_PULL_MS = 180_000;

/** A GitHub-token-shaped string made at run time, so no literal key sits in a shipped file. */
function makeFakeGitHubToken(): string {
  const body = Array.from(
    { length: TOKEN_LENGTH },
    () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)],
  ).join("");
  return ["ghp", body].join("_");
}

const dockerRuns =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe("the gitleaks gate against the real scanner", () => {
  // Needs a Docker daemon and the pinned image; without one there is no scanner to run.
  it.skipIf(!dockerRuns)(
    "fails on a tree holding a planted token",
    () => {
      const context = makeContext({
        ...CLEAN_TREE,
        "config.env": `GITHUB_TOKEN=${makeFakeGitHubToken()}\n`,
      });

      const outcome = scanSecretsGate(
        context,
        createCommandRunner(process.env),
      );

      expect(!outcome.ok && outcome.error.reason).toBe(
        "gitleaks found secrets in the tree; its findings are above, redacted",
      );
    },
    DOCKER_PULL_MS,
  );

  it.skipIf(!dockerRuns)(
    "fails on a tree holding a file gitleaks cannot read",
    () => {
      const context = makeContext({
        ...CLEAN_TREE,
        "fixtures/notes.brief.json": '{"plain":"text"}\n',
      });

      const outcome = scanSecretsGate(
        context,
        createCommandRunner(process.env),
      );

      expect(!outcome.ok && outcome.error.reason).toBe(
        "gitleaks could not read every file; the ERR lines are above",
      );
    },
    DOCKER_PULL_MS,
  );

  it.skipIf(!dockerRuns)(
    "reads the committed fixture brief names",
    () => {
      const context = makeContext({
        ...CLEAN_TREE,
        "fixtures/notes_1_11111111-brief.json": '{"plain":"text"}\n',
      });

      const outcome = scanSecretsGate(
        context,
        createCommandRunner(process.env),
      );

      expect(outcome.ok).toBe(true);
    },
    DOCKER_PULL_MS,
  );

  it.skipIf(!dockerRuns)(
    "passes a planted token the shipped allowlist names",
    () => {
      const token = makeFakeGitHubToken();
      const allowlist = [
        "[extend]",
        "useDefault = true",
        "",
        "[[allowlists]]",
        'description = "the planted test token"',
        `regexes = ["${token}"]`,
        "",
      ].join("\n");
      const context = makeContext({
        ...CLEAN_TREE,
        "config.env": `GITHUB_TOKEN=${token}\n`,
        [GITLEAKS_CONFIG]: allowlist,
      });

      const outcome = scanSecretsGate(
        context,
        createCommandRunner(process.env),
      );

      expect(outcome.ok).toBe(true);
    },
    DOCKER_PULL_MS,
  );
});
