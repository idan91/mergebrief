// `runCli` is the whole CLI behind an injected-deps boundary, command tests
// run it against the REAL api Hono app and assert the contract surface:
// exit 0 ⇒ stdout is documented JSON; exit ≠ 0 ⇒ empty stdout, ONE stderr line.
import { Command } from "commander";
import type { Mutable } from "types/utils";
import operationsMap from "../product-operations.map.json";
import {
  CLI_VERSION,
  createApiClient,
  type ApiClient,
  type FetchLike,
} from "./client";
import {
  fullNameFromOriginUrl,
  loadConfig,
  ownerFromOriginUrl,
  resolveProfile,
  saveConfig,
  type ResolvedProfile,
} from "./profile/config";
import { CliError, ExitCodes } from "./exit";
import {
  runCollaborators,
  runConversation,
  runDelta,
  runDiff,
  runGroups,
  runPrList,
  runPrMeta,
  type ReadIo,
} from "./commands/read";
import { loadRepos, resolveRepoId, type RepoCacheDeps } from "./profile/repos";
import { runCapabilities } from "./commands/capabilities";
import { CLI_CATALOG_FINGERPRINT } from "./generated-catalog-fingerprint";
import {
  buildSubmitPayload,
  requireSpan,
  runGenerate,
  runReady,
  runReply,
  runSubmit,
  runThreadResolution,
  type SubmitInput,
} from "./commands/write";
import {
  requireComparisonSpan,
  requireNarrativeSpan,
  runContext,
  runMarks,
  runNarrative,
  runSession,
} from "./commands/session-read";
import {
  buildCreateDraftPayload,
  buildReanchorPayload,
  buildRiskPayload,
  buildUpdateDraftPayload,
  resolveReadFlag,
  runSessionWrite,
  type AnchorFlags,
  type CreateDraftInput,
  type ReanchorInput,
  type UpdateDraftInput,
} from "./commands/session-write";
import {
  resolveAttachmentMediaType,
  runAttach,
  type AttachDraftTarget,
} from "./commands/attach";

export interface CliDeps {
  readonly fetch: FetchLike;
  /** Read a file for `submit -F <file>`; injected for tests. */
  readonly readFile?: ((path: string) => string) | undefined;
  /** Read an image for `draft attach <file>`; injected for tests. */
  readonly readBinaryFile?: ((path: string) => Uint8Array) | undefined;
  /** `$PAGER` hook for `diff` on a TTY (cosmetic); optional. */
  readonly pager?: ((text: string) => Promise<void>) | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly configDir: string;
  readonly cacheDir: string;
  /** Raw stdout sink, receives EXACT bytes (passthrough, no re-framing). */
  readonly stdout: (text: string) => void;
  /** One-line stderr sink. */
  readonly stderr: (line: string) => void;
  /** Read the pasted/piped token for `auth login`. */
  readonly readStdin: () => Promise<string>;
  /** `git remote get-url origin`, or undefined outside a repo. */
  readonly gitOriginUrl: () => string | undefined;
}

/** The two-level `auth status` shape, additive-only. */
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
  /** `-R owner/name`, overrides origin-remote inference. */
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
    throw new CliError(ExitCodes.USAGE, config.error);
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
    if (error instanceof CliError && error.code === ExitCodes.AUTH) {
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

function describeAuthState(authenticated: boolean | null): string {
  if (authenticated === true) return "authenticated";
  if (authenticated === false) {
    return "NOT authenticated (re-mint at <baseUrl>/settings)";
  }
  return "server unreachable";
}

function emitStatus(deps: CliDeps, json: boolean, body: AuthStatusBody): void {
  if (json) {
    deps.stdout(`${JSON.stringify(body)}\n`);
    return;
  }
  // TTY rendering, explicitly NON-contractual.
  const auth = describeAuthState(body.server.authenticated);
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
    throw new CliError(ExitCodes.USAGE, config.error);
  }
  // MERGEBRIEF_PROFILE selects the login target exactly like --profile.
  const profileName =
    global.profile ?? deps.env["MERGEBRIEF_PROFILE"] ?? "default";
  const existing = config.value.profiles[profileName];
  const baseUrl = options.baseUrl ?? existing?.baseUrl;
  if (baseUrl === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      `profile "${profileName}" has no base URL yet — pass --base-url <deployment origin>`,
    );
  }

  const token = (await deps.readStdin()).trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new CliError(
      ExitCodes.USAGE,
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

  // The login output IS an auth status, no third synthesized shape.
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
    // Passthrough: the server body VERBATIM, not one byte more (even an
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
      ExitCodes.USAGE,
      "no target repository — run inside a git repo with an origin remote, or pass -R owner/name",
    );
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) {
    throw new CliError(
      ExitCodes.USAGE,
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

/** Read the image `draft attach` posts; its leading bytes name its type. */
function readAttachmentFile(
  deps: CliDeps,
  path: string,
): { bytes: Uint8Array; mediaType: string } {
  const readBinaryFile = deps.readBinaryFile;
  if (readBinaryFile === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "file input is not available in this environment",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = readBinaryFile(path);
  } catch {
    throw new CliError(ExitCodes.USAGE, `could not read file: ${path}`);
  }
  return { bytes, mediaType: resolveAttachmentMediaType(bytes) };
}

/** Read `-F`/`--body-file` sources: a path, or "-" for stdin. */
async function readSource(deps: CliDeps, source: string): Promise<string> {
  if (source === "-") {
    return deps.readStdin();
  }
  const readFile = deps.readFile;
  if (readFile === undefined) {
    throw new CliError(
      ExitCodes.USAGE,
      "file input is not available in this environment",
    );
  }
  try {
    return readFile(source);
  } catch {
    throw new CliError(ExitCodes.USAGE, `could not read ${source}`);
  }
}

function parsePayloadSource(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new CliError(ExitCodes.USAGE, "the -F payload is not valid JSON");
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
      ExitCodes.USAGE,
      "--body and --body-file are mutually exclusive",
    );
  }
  if (body !== undefined) {
    return body;
  }
  if (bodyFile !== undefined) {
    return (await readSource(deps, bodyFile)).replace(/\n$/, "");
  }
  throw new CliError(ExitCodes.USAGE, "a reply needs --body or --body-file");
}

function parsePrNumber(raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new CliError(
      ExitCodes.USAGE,
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
    .option("--agents", "deprecated: prints where the agent guide moved", false)
    .option(
      "--profile <name>",
      "config profile (default: owners match, then the default profile)",
    )
    .option(
      "-R, --repo <owner/name>",
      "target repository (default: the origin remote)",
    )
    .exitOverride()
    // Fixed help width: the README appendix embeds this output, so wrapping
    // must not depend on the generating terminal.
    .configureHelp({ helpWidth: 80 })
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
    const globalOptions: Mutable<GlobalOptions> = { json: opts.json };

    if (opts.profile !== undefined) globalOptions.profile = opts.profile;
    if (opts.repo !== undefined) globalOptions.repo = opts.repo;

    return globalOptions;
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
            ExitCodes.USAGE,
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
      "submit a review of the brief span you name (its saved drafts go with it)",
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
    .option("--base <sha>", "span base of the brief you reviewed")
    .option("--head <sha>", "span head of the brief you reviewed")
    .action(
      async (
        raw: string,
        options: {
          file?: string;
          outcome?: string;
          body?: string;
          base?: string;
          head?: string;
        },
      ) => {
        const global = globals();
        const input: Mutable<SubmitInput> = {
          outcome: options.outcome,
          body: options.body,
        };

        if (options.file !== undefined) {
          input.payload = parsePayloadSource(
            await readSource(deps, options.file),
          );
        }

        // Usage validation BEFORE any network work: a malformed PR number or
        // a missing span must exit 2 even when target resolution would fail
        // with exit 4.
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const payload = buildSubmitPayload(input);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSubmit(
          client,
          repoId,
          prNumber,
          span,
          payload,
          readIo(deps, global),
        );
      },
    );

  program
    .command("session")
    .description("your review session on the brief span you name")
    .argument("<number>", "PR number")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(async (raw: string, options: { base?: string; head?: string }) => {
      const global = globals();
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const { client, repoId } = await resolveTarget(deps, global);
      await runSession(client, repoId, prNumber, span, readIo(deps, global));
    });

  program
    .command("marks")
    .description(
      "comparison marks (coordinates only) for a baseline..head span",
    )
    .argument("<number>", "PR number")
    .option("--baseline <sha>", "comparison baseline (required)")
    .option("--head <sha>", "comparison head (required)")
    .action(
      async (raw: string, options: { baseline?: string; head?: string }) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireComparisonSpan(options.baseline, options.head);
        const { client, repoId } = await resolveTarget(deps, global);
        await runMarks(client, repoId, prNumber, span, readIo(deps, global));
      },
    );

  program
    .command("narrative")
    .description("the revision narrative for a prevHead..head hop")
    .argument("<number>", "PR number")
    .option("--prev-head <sha>", "prior briefed head (required)")
    .option("--head <sha>", "revision head (required)")
    .action(
      async (raw: string, options: { prevHead?: string; head?: string }) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireNarrativeSpan(options.prevHead, options.head);
        const { client, repoId } = await resolveTarget(deps, global);
        await runNarrative(
          client,
          repoId,
          prNumber,
          span,
          readIo(deps, global),
        );
      },
    );

  program
    .command("context")
    .description("the brief's repo-config snapshot for the span you name")
    .argument("<number>", "PR number")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(async (raw: string, options: { base?: string; head?: string }) => {
      const global = globals();
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const { client, repoId } = await resolveTarget(deps, global);
      await runContext(client, repoId, prNumber, span, readIo(deps, global));
    });

  const draft = program
    .command("draft")
    .description("draft review comments in your session (posted at submit)");
  draft
    .command("create")
    .description("draft a new inline comment on the brief span you name")
    .argument("<number>", "PR number")
    .option(
      "-F, --payload <path>",
      'full JSON payload from a file, or "-" for stdin',
    )
    .option("--file <path>", "anchor file path (flag form)")
    .option("--side <side>", "old | new (flag form; default: new)")
    .option(
      "--start-side <side>",
      "old | new — side of --start when the range crosses sides (flag form)",
    )
    .option("--start <line>", "anchor start line (flag form)")
    .option("--end <line>", "anchor end line (flag form)")
    .option("--body <text>", "comment body (flag form)")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        options: AnchorFlags & {
          payload?: string;
          body?: string;
          base?: string;
          head?: string;
        },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const input: Mutable<CreateDraftInput> = {
          file: options.file,
          side: options.side,
          startSide: options.startSide,
          start: options.start,
          end: options.end,
          body: options.body,
        };

        if (options.payload !== undefined) {
          input.payload = parsePayloadSource(
            await readSource(deps, options.payload),
          );
        }

        const payload = buildCreateDraftPayload(input);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "POST",
            repoId,
            prNumber,
            subpath: "/comments",
            span,
            payload,
          },
          readIo(deps, global),
        );
      },
    );
  draft
    .command("update")
    .description("edit a held draft's body")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)")
    .option(
      "-F, --payload <path>",
      'full JSON payload from a file, or "-" for stdin',
    )
    .option("--body <text>", "new comment body (flag form)")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        draftId: string,
        options: {
          payload?: string;
          body?: string;
          base?: string;
          head?: string;
        },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const input: Mutable<UpdateDraftInput> = { body: options.body };

        if (options.payload !== undefined) {
          input.payload = parsePayloadSource(
            await readSource(deps, options.payload),
          );
        }

        const payload = buildUpdateDraftPayload(input);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "PATCH",
            repoId,
            prNumber,
            subpath: `/comments/${encodeURIComponent(draftId)}`,
            span,
            payload,
          },
          readIo(deps, global),
        );
      },
    );
  draft
    .command("reanchor")
    .description("move a held draft's anchor (settles a carried orphan)")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)")
    .option(
      "-F, --payload <path>",
      'full JSON payload from a file, or "-" for stdin',
    )
    .option("--file <path>", "anchor file path (flag form)")
    .option("--side <side>", "old | new (flag form; default: new)")
    .option(
      "--start-side <side>",
      "old | new — side of --start when the range crosses sides (flag form)",
    )
    .option("--start <line>", "anchor start line (flag form)")
    .option("--end <line>", "anchor end line (flag form)")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        draftId: string,
        options: AnchorFlags & {
          payload?: string;
          base?: string;
          head?: string;
        },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const input: Mutable<ReanchorInput> = {
          file: options.file,
          side: options.side,
          startSide: options.startSide,
          start: options.start,
          end: options.end,
        };

        if (options.payload !== undefined) {
          input.payload = parsePayloadSource(
            await readSource(deps, options.payload),
          );
        }

        const payload = buildReanchorPayload(input);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "PUT",
            repoId,
            prNumber,
            subpath: `/comments/${encodeURIComponent(draftId)}/anchor`,
            span,
            payload,
          },
          readIo(deps, global),
        );
      },
    );
  draft
    .command("delete")
    .description("delete a held draft")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        draftId: string,
        options: { base?: string; head?: string },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "DELETE",
            repoId,
            prNumber,
            subpath: `/comments/${encodeURIComponent(draftId)}`,
            span,
          },
          readIo(deps, global),
        );
      },
    );

  draft
    .command("attach")
    .description(
      "upload an image to the repository's attachments branch; prints {url}",
    )
    .argument("<number>", "PR number")
    .argument("<file>", "a png, jpg, gif or webp file")
    .option(
      "--draft <draftId>",
      "also append the image to this held draft (needs --base and --head)",
    )
    .option("--base <sha>", "span base of the brief (with --draft)")
    .option("--head <sha>", "span head of the brief (with --draft)")
    .action(
      async (
        raw: string,
        path: string,
        options: { draft?: string; base?: string; head?: string },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const file = readAttachmentFile(deps, path);
        let target: AttachDraftTarget | undefined;
        if (options.draft !== undefined) {
          target = {
            draftId: options.draft,
            span: requireSpan(options.base, options.head),
          };
        }
        const { client, repoId } = await resolveTarget(deps, global);
        await runAttach(
          client,
          { repoId, prNumber, file, draft: target },
          readIo(deps, global),
        );
      },
    );

  program
    .command("chunk-read")
    .description("mark a brief chunk read (--unread clears the mark)")
    .argument("<number>", "PR number")
    .argument("<chunkId>", "the chunk id as the brief spells it")
    .option("--read", "mark read (the default)")
    .option("--unread", "clear the read mark")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        chunkId: string,
        options: {
          read?: boolean;
          unread?: boolean;
          base?: string;
          head?: string;
        },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const read = resolveReadFlag(options.read, options.unread);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "PUT",
            repoId,
            prNumber,
            subpath: `/chunks/${encodeURIComponent(chunkId)}/read`,
            span,
            payload: { read },
          },
          readIo(deps, global),
        );
      },
    );

  const risk = program
    .command("risk")
    .description("disposition the brief's risk flags in your session");
  const riskAction =
    (subpath: string, takesReason: boolean) =>
    async (
      raw: string,
      options: {
        payload?: string;
        reason?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const global = globals();
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const payload = buildRiskPayload(
        options.payload === undefined
          ? undefined
          : parsePayloadSource(await readSource(deps, options.payload)),
        takesReason ? options.reason : undefined,
      );
      const { client, repoId } = await resolveTarget(deps, global);
      await runSessionWrite(
        client,
        { method: "POST", repoId, prNumber, subpath, span, payload },
        readIo(deps, global),
      );
    };
  risk
    .command("dismiss")
    .description("dismiss risk flags (the payload's flags array names them)")
    .argument("<number>", "PR number")
    .option(
      "-F, --payload <path>",
      'JSON payload from a file, or "-" for stdin (required)',
    )
    .option(
      "--reason <text>",
      "dismissal reason (unless the payload carries one)",
    )
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(riskAction("/risks/dismiss", true));
  risk
    .command("address")
    .description("mark risk flags addressed (each flag carries its evidence)")
    .argument("<number>", "PR number")
    .option(
      "-F, --payload <path>",
      'JSON payload from a file, or "-" for stdin (required)',
    )
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(riskAction("/risks/address", false));
  risk
    .command("reopen")
    .description("undo dispositions on risk flags")
    .argument("<number>", "PR number")
    .option(
      "-F, --payload <path>",
      'JSON payload from a file, or "-" for stdin (required)',
    )
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(riskAction("/risks/reopen", false));

  program
    .command("reclassify")
    .description("override a change group's category in your session")
    .argument("<number>", "PR number")
    .argument("<groupId>", "the change group id (see `groups <n>`)")
    .requiredOption("--category <category>", "the category to record")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        groupId: string,
        options: { category: string; base?: string; head?: string },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "PUT",
            repoId,
            prNumber,
            subpath: `/groups/${encodeURIComponent(groupId)}/classification`,
            span,
            payload: { category: options.category },
          },
          readIo(deps, global),
        );
      },
    );

  program
    .command("outcome")
    .description("set your session's review intent (publishing is `submit`)")
    .argument("<number>", "PR number")
    .argument("<outcome>", "comment | approve | request-changes")
    .option("--base <sha>", "span base of the brief (required)")
    .option("--head <sha>", "span head of the brief (required)")
    .action(
      async (
        raw: string,
        outcome: string,
        options: { base?: string; head?: string },
      ) => {
        const global = globals();
        const prNumber = parsePrNumber(raw);
        const span = requireSpan(options.base, options.head);
        const { client, repoId } = await resolveTarget(deps, global);
        await runSessionWrite(
          client,
          {
            method: "PUT",
            repoId,
            prNumber,
            subpath: "/outcome",
            span,
            payload: { outcome },
          },
          readIo(deps, global),
        );
      },
    );

  const thread = program
    .command("thread")
    .description("review-thread state on GitHub (the viewer's own act)");
  const threadAction =
    (resolved: boolean) => async (raw: string, commentId: string) => {
      const global = globals();
      const prNumber = parsePrNumber(raw);
      const { client, repoId } = await resolveTarget(deps, global);
      await runThreadResolution(
        client,
        repoId,
        prNumber,
        commentId,
        resolved,
        readIo(deps, global),
      );
    };
  thread
    .command("resolve")
    .description("resolve the thread rooted at a review comment")
    .argument("<number>", "PR number")
    .argument("<commentId>", "the thread's root review comment id")
    .action(threadAction(true));
  thread
    .command("unresolve")
    .description("reopen the thread rooted at a review comment")
    .argument("<number>", "PR number")
    .argument("<commentId>", "the thread's root review comment id")
    .action(threadAction(false));

  program
    .command("ready")
    .description(
      "mark a draft PR ready for review (GitHub-enforced authorship)",
    )
    .argument("<number>", "PR number")
    .action(async (raw: string) => {
      const global = globals();
      const prNumber = parsePrNumber(raw);
      const { client, repoId } = await resolveTarget(deps, global);
      await runReady(client, repoId, prNumber, readIo(deps, global));
    });

  program
    .command("generate")
    .description("generate a brief for a PR URL (no confirm; your own key)")
    .argument("<url>", "the PR's GitHub URL")
    .action(async (url: string) => {
      const global = globals();
      const resolved = resolveFromDisk(deps, global.profile);
      await runGenerate(clientFor(deps, resolved), url, readIo(deps, global));
    });

  program
    .command("collaborators")
    .description("the target repo's collaborator roster (push access required)")
    .action(async () => {
      const global = globals();
      const { client, repoId } = await resolveTarget(deps, global);
      await runCollaborators(client, repoId, readIo(deps, global));
    });

  program
    .command("capabilities")
    .description(
      "what this server+CLI pair can run; --require makes it a fail-closed check",
    )
    .option(
      "--require <ids...>",
      "operation ids that must be runnable here (any failure → exit 6)",
    )
    .action(async (options: { require?: string[] }) => {
      const global = globals();
      const resolved = resolveFromDisk(deps, global.profile);
      await runCapabilities({
        client: clientFor(deps, resolved),
        cliVersion: CLI_VERSION,
        cliCatalogFingerprint: CLI_CATALOG_FINGERPRINT,
        operationsMapRaw: operationsMap,
        requireIds: options.require ?? [],
        io: readIo(deps, global),
      });
    });

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

const AGENTS_MOVED = `The packaged agent guide moved: it now ships as the \`mergebrief\`
agent skill, alongside the CLI in its repository (skills/mergebrief).
Install it into your agent with skills.sh:

    npx skills add <owner>/<repo> --skill mergebrief -a <your-agent>

The MergeBrief repository README carries the install command; substitute
your deployment's <owner>/<repo>. With the skill installed, your agent
needs nothing from this flag.
`;

/**
 * Run the CLI: parse + execute + map every failure to the stream/exit
 * invariant. Returns the process exit code; never throws.
 */
export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  if (argv.includes("--agents")) {
    deps.stdout(AGENTS_MOVED);
    return ExitCodes.OK;
  }
  try {
    await buildProgram(deps).parseAsync([...argv], { from: "user" });
    return ExitCodes.OK;
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
        return ExitCodes.OK;
      }
      // Usage errors already printed one line via configureOutput.
      return ExitCodes.USAGE;
    }
    deps.stderr(error instanceof Error ? error.message : "unexpected error");
    return ExitCodes.GENERIC;
  }
}
