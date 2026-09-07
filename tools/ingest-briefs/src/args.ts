// The CLI's argument grammar, kept out of `main.ts` so tests can parse a
// command line without importing the module that runs the ingest on load.
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Every flag is `--name`; the same two dashes alone are pnpm's separator. */
const FLAG_PREFIX = "--";
const PNPM_SEPARATOR = "--";

/** The one flag that takes no value. */
const RESOLVE_REPOS_FLAG = "resolve-repos";

/** The default artifact directory, relative to this file. */
const DEFAULT_DIR = "../../categorizer/out";

export interface CliArgs {
  readonly dir: string;
  readonly target: string;
  readonly repoId?: string;
  readonly resolveRepos: boolean;
  readonly state: "open" | "merged";
}

const CliArgsSchema = z.object({
  dir: z.string().optional(),
  target: z.string().regex(/^(user|installation):\d+$/),
  "repo-id": z.string().regex(/^\d+$/).optional(),
  [RESOLVE_REPOS_FLAG]: z.boolean().default(false),
  state: z.enum(["open", "merged"]).default("open"),
});

/** `--name value` pairs plus the one valueless flag, unvalidated. */
function collectFlags(
  argv: readonly string[],
): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    // pnpm forwards the separator through to the script, so a lone one is an
    // argument here, not a flag.
    if (raw === PNPM_SEPARATOR) {
      continue;
    }
    if (raw === undefined || !raw.startsWith(FLAG_PREFIX)) {
      throw new Error(`unexpected argument: ${String(raw)}`);
    }
    const name = raw.slice(FLAG_PREFIX.length);
    if (name === RESOLVE_REPOS_FLAG) {
      args[name] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`--${name} needs a value`);
    }
    args[name] = value;
    // The value was this flag's, not the next flag, step over it.
    i += 1;
  }
  return args;
}

export function parseArgs(
  argv: readonly string[],
  invokerDir: string,
): CliArgs {
  const parsed = CliArgsSchema.parse(collectFlags(argv));
  const base = {
    dir: resolveDir(parsed.dir, invokerDir),
    target: parsed.target,
    resolveRepos: parsed[RESOLVE_REPOS_FLAG],
    state: parsed.state,
  };
  const repoId = parsed["repo-id"];
  return repoId === undefined ? base : { ...base, repoId };
}

/**
 * pnpm runs scripts with cwd = the package dir, so a relative `--dir`
 * resolves against the invoker's directory (`INIT_CWD`, passed by main) and
 * the default resolves against this file.
 */
function resolveDir(dir: string | undefined, invokerDir: string): string {
  if (dir === undefined) {
    return fileURLToPath(new URL(DEFAULT_DIR, import.meta.url));
  }
  if (isAbsolute(dir)) {
    return dir;
  }
  return resolve(invokerDir, dir);
}
