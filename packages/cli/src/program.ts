// `runCli` is the whole CLI behind an injected-deps boundary — command tests
// run it against the REAL api Hono app and assert the contract surface:
// exit 0 ⇒ stdout is documented JSON; exit ≠ 0 ⇒ empty stdout, ONE stderr line.
import { Command } from "commander";
import { createApiClient, type ApiClient, type FetchLike } from "./client";
import {
  fullNameFromOriginUrl,
  loadConfig,
  ownerFromOriginUrl,
  resolveProfile,
  saveConfig,
  type ResolvedProfile,
} from "./profile/config";
import { CliError, ExitCode } from "./exit";
import {
  runConversation,
  runDelta,
  runDiff,
  runGroups,
  runPrList,
  runPrMeta,
  type ReadIo,
} from "./commands/read";
import { loadRepos, resolveRepoId, type RepoCacheDeps } from "./profile/repos";
import { AGENTS_GUIDE } from "./agents-guide";
import {
  buildSubmitPayload,
  runReply,
  runSubmit,
  type SubmitInput,
} from "./commands/write";

export interface CliDeps {
  readonly fetch: FetchLike;
  /** Read a file for `submit -F <file>`; injected for tests. */
  readonly readFile?: ((path: string) => string) | undefined;
  /** `$PAGER` hook for `diff` on a TTY (cosmetic); optional. */
  readonly pager?: ((text: string) => Promise<void>) | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly configDir: string;
  readonly cacheDir: string;
  /** Raw stdout sink — receives EXACT bytes (passthrough, no re-framing). */
  readonly stdout: (text: string) => void;
  /** One-line stderr sink. */
  readonly stderr: (line: string) => void;
  /** Read the pasted/piped token for `auth login`. */
  readonly readStdin: () => Promise<string>;
  /** `git remote get-url origin`, or undefined outside a repo. */
  readonly gitOriginUrl: () => string | undefined;
}

/** The two-level `auth status` shape — additive-only. */
interface AuthStatusBody {
  readonly profile: string;
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly server: {
    readonly reachable: boolean;
    /** null when unreachable (undetermined). */
    readonly authenticated: boolean | null;
    /** The server's version, null when undetermined. */
    readonly version: string | null;
  };
}

interface GlobalOptions {
  readonly json: boolean;
  readonly profile?: string;
  /** `-R owner/name` — overrides origin-remote inference. */
  readonly repo?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clientFor(deps: CliDeps, resolved: ResolvedProfile): ApiClient {
  return createApiClient({
    fetch: deps.fetch,
    baseUrl: resolved.profile.baseUrl,
    token: resolved.token,
    headers: resolved.profile.headers,
  });
}

function resolveFromDisk(
  deps: CliDeps,
  flagProfile: string | undefined,
): ResolvedProfile {
  const config = loadConfig(deps.configDir);
  if (!config.ok) {
    throw new CliError(ExitCode.USAGE, config.error);
  }
  const originUrl = deps.gitOriginUrl();
  return resolveProfile({
    config: config.value,
    env: deps.env,
    flagProfile,
    gitRemoteOwner:
      originUrl === undefined ? undefined : ownerFromOriginUrl(originUrl),
  });
}

/** Probe the server (version + auth in one gated read); never throws. */
async function probeServer(
  client: ApiClient,
): Promise<AuthStatusBody["server"]> {
  try {
    const response = await client.request({ path: "/api/version" });
    const parsed: unknown = JSON.parse(response.bodyText);
    let version: string | null = null;
    if (isRecord(parsed)) {
      const value = parsed["version"];
      if (typeof value === "string") {
        version = value;
      }
    }
    return { reachable: true, authenticated: true, version };
  } catch (error) {
    if (error instanceof CliError && error.code === ExitCode.AUTH) {
      return { reachable: true, authenticated: false, version: null };
    }
    return { reachable: false, authenticated: null, version: null };
  }
}

async function authStatusBody(
  deps: CliDeps,
  resolved: ResolvedProfile,
): Promise<AuthStatusBody> {
  return {
    profile: resolved.name,
    baseUrl: resolved.profile.baseUrl,
    tokenConfigured: resolved.token !== undefined,
    server: await probeServer(clientFor(deps, resolved)),
  };
}

function emitStatus(deps: CliDeps, json: boolean, body: AuthStatusBody): void {
  if (json) {
    deps.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  // TTY rendering — explicitly NON-contractual.
  const auth =
    body.server.authenticated === true
      ? "authenticated"
      : body.server.authenticated === false
        ? "NOT authenticated (re-mint at <baseUrl>/settings)"
        : "server unreachable";
  deps.stdout(
    `profile ${body.profile} → ${body.baseUrl}\n` +
      `token: ${body.tokenConfigured ? "configured" : "missing"} · ${auth}` +
      `${body.server.version === null ? "" : ` · server ${body.server.version}`}\n`,
  );
}

const TOKEN_PREFIX = "mergebrief_";

async function runAuthLogin(
  deps: CliDeps,
  global: GlobalOptions,
  options: { readonly baseUrl?: string },
): Promise<void> {
  const config = loadConfig(deps.configDir);
  if (!config.ok) {
    throw new CliError(ExitCode.USAGE, config.error);
  }
  // MERGEBRIEF_PROFILE selects the login target exactly like --profile.
  const profileName =
    global.profile ?? deps.env["MERGEBRIEF_PROFILE"] ?? "default";
  const existing = config.value.profiles[profileName];
  const baseUrl = options.baseUrl ?? existing?.baseUrl;
  if (baseUrl === undefined) {
    throw new CliError(
      ExitCode.USAGE,
      `profile "${profileName}" has no base URL yet — pass --base-url <deployment origin>`,
    );
  }

  const token = (await deps.readStdin()).trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(
      ExitCode.USAGE,
      `that does not look like a MergeBrief token (expected the ${TOKEN_PREFIX} prefix) — mint one at ${baseUrl}/settings`,
    );
  }

  const next = {
    defaultProfile: config.value.defaultProfile ?? profileName,
    profiles: {
      ...config.value.profiles,
      [profileName]: { ...existing, baseUrl, token },
    },
  };
  saveConfig(deps.configDir, next);

  // The login output IS an auth status — no third synthesized shape.
  const savedProfile = next.profiles[profileName];
  if (savedProfile === undefined) {
    throw new Error("profile vanished after save"); // unreachable
  }
  // Verify the credential BEING INSTALLED: the env override must not mask a
  // bad paste, so it never applies to login's own verification.
  const resolved: ResolvedProfile = {
    name: profileName,
    profile: savedProfile,
    token,
  };
  emitStatus(deps, global.json, await authStatusBody(deps, resolved));
}

async function runAuthStatus(
  deps: CliDeps,
  global: GlobalOptions,
): Promise<void> {
  const resolved = resolveFromDisk(deps, global.profile);
  emitStatus(deps, global.json, await authStatusBody(deps, resolved));
}

async function runRepos(
  deps: CliDeps,
  global: GlobalOptions,
  options: { readonly refresh: boolean },
): Promise<void> {
  const resolved = resolveFromDisk(deps, global.profile);
  const cacheDeps: RepoCacheDeps = {
    client: clientFor(deps, resolved),
    cacheDir: deps.cacheDir,
    profileName: resolved.name,
  };
  const { body, bodyText } = await loadRepos(cacheDeps, options);
  if (global.json) {
    // Passthrough: the server body VERBATIM — not one byte more (even an
    // appended newline is a byte the server never sent).
    deps.stdout(bodyText);
    return;
  }
  for (const repo of body.repos) {
    deps.stdout(`${repo.fullName}\t${repo.repoId}\n`);
  }
}

/** Resolve the PR-addressed commands' target repo: `-R` beats the origin
 * remote; no prompts, ever. */
async function resolveTarget(
  deps: CliDeps,
  global: GlobalOptions,
): Promise<{ client: ApiClient; repoId: string }> {
  const resolved = resolveFromDisk(deps, global.profile);
  const originUrl = deps.gitOriginUrl();
  const fullName =
    global.repo ??
    (originUrl === undefined ? undefined : fullNameFromOriginUrl(originUrl));
  if (fullName === undefined) {
    throw new CliError(
      ExitCode.USAGE,
      "no target repository — run inside a git repo with an origin remote, or pass -R owner/name",
    );
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
    throw new CliError(
      ExitCode.USAGE,
      `-R expects owner/name, got "${fullName}"`,
    );
  }
  const client = clientFor(deps, resolved);
  const repoId = await resolveRepoId(
    { client, cacheDir: deps.cacheDir, profileName: resolved.name },
    fullName,
  );
  return { client, repoId };
}

function readIo(deps: CliDeps, global: GlobalOptions): ReadIo {
  return { stdout: deps.stdout, stderr: deps.stderr, json: global.json };
}

/** Read `-F`/`--body-file` sources: a path, or "-" for stdin. */
async function readSource(deps: CliDeps, source: string): Promise<string> {
  if (source === "-") {
    return deps.readStdin();
  }
  const readFile = deps.readFile;
  if (readFile === undefined) {
    throw new CliError(
      ExitCode.USAGE,
      "file input is not available in this environment",
    );
  }
  try {
    return readFile(source);
  } catch {
    throw new CliError(ExitCode.USAGE, `could not read ${source}`);
  }
}

function parsePayloadSource(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError(ExitCode.USAGE, "the -F payload is not valid JSON");
  }
}

/** `--body` beats `--body-file`; one of them is required. */
async function readBodySource(
  deps: CliDeps,
  body: string | undefined,
  bodyFile: string | undefined,
): Promise<string> {
  if (body !== undefined && bodyFile !== undefined) {
    throw new CliError(
      ExitCode.USAGE,
      "--body and --body-file are mutually exclusive",
    );
  }
  if (body !== undefined) {
    return body;
  }
  if (bodyFile !== undefined) {
    return (await readSource(deps, bodyFile)).replace(/\n$/, "");
  }
  throw new CliError(ExitCode.USAGE, "a reply needs --body or --body-file");
}

function parsePrNumber(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new CliError(
      ExitCode.USAGE,
      `PR number must be a positive integer, got "${raw}"`,
    );
  }
  return Number(raw);
}

/** Build the commander program over injected deps. */
export function buildProgram(deps: CliDeps): Command {
  const program = new Command("mergebrief");
  program
    .description(
      "MergeBrief — PR briefs for humans and agents, over your deployment's API",
    )
    .option("--json", "machine output: the documented JSON contract", false)
    .option("--agents", "print the packaged agent guide and exit", false)
    .option(
      "--profile <name>",
      "config profile (default: owners match, then the default profile)",
    )
    .option(
      "-R, --repo <owner/name>",
      "target repository (default: the origin remote)",
    )
    .exitOverride()
    .configureOutput({
      writeOut: (str) => deps.stdout(str),
      writeErr: (str) => deps.stderr(str.trimEnd()),
    });

  const globals = (): GlobalOptions => {
    const opts = program.opts<{
      json: boolean;
      profile?: string;
      repo?: string;
    }>();
    return {
      json: opts.json,
      ...(opts.profile === undefined ? {} : { profile: opts.profile }),
      ...(opts.repo === undefined ? {} : { repo: opts.repo }),
    };
  };

  const auth = program
    .command("auth")
    .description("authentication against your deployment");
  auth
    .command("login")
    .description("store a token for a profile (paste it, or pipe it on stdin)")
    .option(
      "--base-url <url>",
      "deployment origin, e.g. https://mergebrief.example.com",
    )
    .action(async (options: { baseUrl?: string }) =>
      runAuthLogin(deps, globals(), options),
    );
  auth
    .command("status")
    .description("config + server status for the resolved profile")
    .action(async () => runAuthStatus(deps, globals()));

  program
    .command("repos")
    .description(
      "repositories visible to the profile's token (cached; see --refresh)",
    )
    .option("--refresh", "bypass the disk cache", false)
    .action(async (options: { refresh: boolean }) =>
      runRepos(deps, globals(), options),
    );

  program
    .command("pr")
    .description("your PRs (no argument), or one PR's metadata")
    .argument("[number]", "PR number in the target repository")
    .action(async (raw: string | undefined) => {
      const global = globals();
      if (raw === undefined) {
        const resolved = resolveFromDisk(deps, global.profile);
        await runPrList(clientFor(deps, resolved), readIo(deps, global));
        return;
      }
      const { client, repoId } = await resolveTarget(deps, global);
      await runPrMeta(client, repoId, parsePrNumber(raw), readIo(deps, global));
    });

  program
    .command("groups")
    .description("the PR's brief — change groups over the current span")
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const global = globals();
      const { client, repoId } = await resolveTarget(deps, global);
      await runGroups(client, repoId, parsePrNumber(raw), readIo(deps, global));
    });

  program
    .command("conversation")
    .description("the PR's review conversation")
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const global = globals();
      const { client, repoId } = await resolveTarget(deps, global);
      await runConversation(
        client,
        repoId,
        parsePrNumber(raw),
        readIo(deps, global),
      );
    });

  program
    .command("diff")
    .description("the PR's unified diff (its raw text IS the machine format)")
    .argument("<number>", "PR number")
    .option("--base <sha>", "span base (with --head)")
    .option("--head <sha>", "span head (with --base)")
    .option(
      "--group <id>",
      "filter to one change group's whole hunks (brief span only)",
    )
    .action(
      async (
        raw: string,
        options: { base?: string; head?: string; group?: string },
      ) => {
        const global = globals();
        if (global.json) {
          throw new CliError(
            ExitCode.USAGE,
            "diff has no JSON arm — its raw output is the machine format",
          );
        }
        const { client, repoId } = await resolveTarget(deps, global);
        await runDiff(
          client,
          repoId,
          parsePrNumber(raw),
          { ...options, pager: deps.pager },
          readIo(deps, global),
        );
      },
    );

  program
    .command("reply")
    .description("reply to a review comment (the viewer's own voice)")
    .argument("<commentId>", "the review comment id (see `conversation <n>`)")
    .requiredOption("--pr <number>", "the PR the comment belongs to")
    .option("--body <text>", "reply text")
    .option("--body-file <path>", 'reply text from a file, or "-" for stdin')
    .action(
      async (
        commentId: string,
        options: { pr: string; body?: string; bodyFile?: string },
      ) => {
        const global = globals();
        const body = await readBodySource(deps, options.body, options.bodyFile);
        const { client, repoId } = await resolveTarget(deps, global);
        await runReply(
          client,
          repoId,
          commentId,
          { pr: parsePrNumber(options.pr), body },
          readIo(deps, global),
        );
      },
    );

  program
    .command("submit")
    .description(
      "submit a review (commitId is required and never auto-fetched)",
    )
    .argument("<number>", "PR number")
    .option(
      "-F, --file <path>",
      'full JSON payload from a file, or "-" for stdin',
    )
    .option(
      "--outcome <outcome>",
      "comment | approve | request-changes (flag form)",
    )
    .option("--body <text>", "review body (flag form)")
    .option("--commit <sha>", "the commitId you reviewed (flag form)")
    .action(
      async (
        raw: string,
        options: {
          file?: string;
          outcome?: string;
          body?: string;
          commit?: string;
        },
      ) => {
        const global = globals();
        const input: SubmitInput = {
          ...(options.file === undefined
            ? {}
            : {
                payload: parsePayloadSource(
                  await readSource(deps, options.file),
                ),
              }),
          outcome: options.outcome,
          body: options.body,
          commit: options.commit,
        };
        // Usage validation BEFORE any network work: a malformed PR number or
        // a missing --commit must exit 2 even when target resolution would
        // fail with exit 4.
        const prNumber = parsePrNumber(raw);
        const payload = buildSubmitPayload(input);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSubmit(
          client,
          repoId,
          prNumber,
          payload,
          readIo(deps, global),
        );
      },
    );

  program
    .command("delta")
    .description("what changed since your last review (union: available | not)")
    .argument("<number>", "PR number")
    .option(
      "--baseline <sha>",
      "override the checkpoint baseline (with --head)",
    )
    .option("--head <sha>", "override the head (with --baseline)")
    .action(
      async (raw: string, options: { baseline?: string; head?: string }) => {
        const global = globals();
        const { client, repoId } = await resolveTarget(deps, global);
        await runDelta(
          client,
          repoId,
          parsePrNumber(raw),
          options,
          readIo(deps, global),
        );
      },
    );

  return program;
}

/**
 * Run the CLI: parse + execute + map every failure to the stream/exit
 * invariant. Returns the process exit code; never throws.
 */
export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  // Print and exit before any parsing side effects — agents read this first.
  if (argv.includes("--agents")) {
    deps.stdout(AGENTS_GUIDE);
    return ExitCode.OK;
  }
  try {
    await buildProgram(deps).parseAsync([...argv], { from: "user" });
    return ExitCode.OK;
  } catch (error) {
    if (error instanceof CliError) {
      deps.stderr(error.message);
      return error.code;
    }
    // Commander's own exits (bad flags, --help). Help/version are success.
    if (isRecord(error) && typeof error["code"] === "string") {
      const code = error["code"];
      if (
        code === "commander.helpDisplayed" ||
        code === "commander.help" ||
        code === "commander.version"
      ) {
        return ExitCode.OK;
      }
      // Usage errors already printed one line via configureOutput.
      return ExitCode.USAGE;
    }
    deps.stderr(error instanceof Error ? error.message : "unexpected error");
    return ExitCode.GENERIC;
  }
}
