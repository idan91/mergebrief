// The command surface (BRIEF-17 PR 5: `auth login`, `auth status`, `repos`;
// the read/write commands land in the next PRs). `runCli` is the whole CLI
// behind an injected-deps seam — command tests run it against the REAL api
// Hono app and assert the contract surface directly: captured stdout/stderr
// + the returned exit code (ADR 0029 #5: exit 0 ⇒ stdout is documented JSON;
// exit ≠ 0 ⇒ empty stdout, ONE stderr line).
import { Command } from "commander";
import { createApiClient, type ApiClient, type FetchLike } from "./client";
import {
  loadConfig,
  ownerFromOriginUrl,
  resolveProfile,
  saveConfig,
  type ResolvedProfile,
} from "./config";
import { CliError, ExitCode } from "./exit";

export interface CliDeps {
  readonly fetch: FetchLike;
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

/** The two-level `auth status` shape (ADR 0029 #2b) — additive-only. */
interface AuthStatusBody {
  readonly profile: string;
  readonly baseUrl: string;
  readonly tokenConfigured: boolean;
  readonly server: {
    readonly reachable: boolean;
    /** null when unreachable (undetermined). */
    readonly authenticated: boolean | null;
    /** The server's version (ADR 0029 #8), null when undetermined. */
    readonly version: string | null;
  };
}

interface GlobalOptions {
  readonly json: boolean;
  readonly profile?: string;
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

function resolveFromDisk(deps: CliDeps, flagProfile: string | undefined): ResolvedProfile {
  const config = loadConfig(deps.configDir);
  if (!config.ok) {
    throw new CliError(ExitCode.USAGE, config.error);
  }
  const originUrl = deps.gitOriginUrl();
  return resolveProfile({
    config: config.value,
    env: deps.env,
    flagProfile,
    gitRemoteOwner: originUrl === undefined ? undefined : ownerFromOriginUrl(originUrl),
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
  // TTY rendering — explicitly NON-contractual (ADR 0029 #7).
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
  // The explicit-profile arm matches the resolution order (codex PR5 R1):
  // MERGEBRIEF_PROFILE selects the login target exactly like --profile.
  const profileName = global.profile ?? deps.env["MERGEBRIEF_PROFILE"] ?? "default";
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

  // Verify immediately and report as the documented auth-status shape (the
  // login output IS an auth status — no third synthesized shape).
  const savedProfile = next.profiles[profileName];
  if (savedProfile === undefined) {
    throw new Error("profile vanished after save"); // unreachable
  }
  // Verify the credential BEING INSTALLED (codex PR5 R1): the env override
  // must not mask a bad paste (or fail a good one) — it applies to commands
  // resolving a stored profile, never to login's own verification.
  const resolved: ResolvedProfile = {
    name: profileName,
    profile: savedProfile,
    token,
  };
  emitStatus(deps, global.json, await authStatusBody(deps, resolved));
}

async function runAuthStatus(deps: CliDeps, global: GlobalOptions): Promise<void> {
  const resolved = resolveFromDisk(deps, global.profile);
  emitStatus(deps, global.json, await authStatusBody(deps, resolved));
}


/** Build the commander program over injected deps. */
function buildProgram(deps: CliDeps): Command {
  const program = new Command("mergebrief");
  program
    .description("MergeBrief — PR briefs for humans and agents, over your deployment's API")
    .option("--json", "machine output: the documented JSON contract (ADR 0029)", false)
    .option("--profile <name>", "config profile (default: owners match, then the default profile)")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => deps.stdout(str),
      writeErr: (str) => deps.stderr(str.trimEnd()),
    });

  const globals = (): GlobalOptions => {
    const opts = program.opts<{ json: boolean; profile?: string }>();
    return { json: opts.json, ...(opts.profile === undefined ? {} : { profile: opts.profile }) };
  };

  const auth = program.command("auth").description("authentication against your deployment");
  auth
    .command("login")
    .description("store a token for a profile (paste it, or pipe it on stdin)")
    .option("--base-url <url>", "deployment origin, e.g. https://mergebrief.example.com")
    .action(async (options: { baseUrl?: string }) => runAuthLogin(deps, globals(), options));
  auth
    .command("status")
    .description("config + server status for the resolved profile")
    .action(async () => runAuthStatus(deps, globals()));

  return program;
}

/**
 * Run the CLI: parse + execute + map every failure to the stream/exit
 * invariant. Returns the process exit code; never throws.
 */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
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
      if (code === "commander.helpDisplayed" || code === "commander.help" || code === "commander.version") {
        return ExitCode.OK;
      }
      // Usage errors already printed one line via configureOutput.
      return ExitCode.USAGE;
    }
    deps.stderr(error instanceof Error ? error.message : "unexpected error");
    return ExitCode.GENERIC;
  }
}
