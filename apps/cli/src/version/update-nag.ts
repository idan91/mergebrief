// The daily npm check (gh's model): fired beside the command, taken only if
// it settled by exit, otherwise aborted; the answer lands in the cache and
// prints on the next successful run, once per answer. A failed run neither
// prints nor consumes it. A failure is silent. The request carries nothing
// about the instance.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import {
  NO_VERSION_WARNING_ENV,
  NPM_REGISTRY_LATEST_URL,
  PACKAGE_NAME,
  UPDATE_CACHE_FILE,
  UPDATE_CHECK_MAX_AGE_MS,
  UPDATE_CHECK_TIMEOUT_MS,
} from "./consts";
import {
  buildUpdateCommand,
  compareSemver,
  detectLaunchForm,
  formatSemver,
  isDevVersion,
  parseSemver,
} from "./index";

/** `fetch`-compatible; aborts through the signal. */
export type UpdateFetch = (
  input: string,
  init: { readonly signal: AbortSignal },
) => Promise<Response>;

export interface UpdateCheckDeps {
  readonly fetch: UpdateFetch;
  readonly cacheDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cliVersion: string;
  /** Test seam; production takes the clock. */
  readonly now?: () => number;
}

export interface UpdateCheckHandle {
  /**
   * Called once the command finished: takes a settled answer into the cache
   * or aborts the request, then returns the nag the cache owes. Only a
   * successful run prints it, so a failed run keeps stderr to its one line
   * and leaves the nag owed.
   */
  settle(succeeded: boolean): string | undefined;
}

const cacheSchema = z.object({
  latest: z.string().min(1),
  checkedAt: z.string().min(1),
  notified: z.boolean().default(false),
});
type UpdateCache = z.infer<typeof cacheSchema>;

const registrySchema = z.object({ version: z.string().min(1) });

function resolveCachePath(cacheDir: string): string {
  return join(cacheDir, UPDATE_CACHE_FILE);
}

function readCache(cacheDir: string): UpdateCache | undefined {
  try {
    const text = readFileSync(resolveCachePath(cacheDir), "utf8");
    const parsed = cacheSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(cacheDir: string, cache: UpdateCache): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(resolveCachePath(cacheDir), JSON.stringify(cache));
  } catch {
    // An unwritable cache dir means a check on every run and never a nag.
  }
}

/** A stamp in the future counts as stale, so a clock jump cannot pin the cache. */
function isFresh(cache: UpdateCache | undefined, nowMs: number): boolean {
  if (cache === undefined) {
    return false;
  }
  const age = nowMs - Date.parse(cache.checkedAt);
  return age >= 0 && age < UPDATE_CHECK_MAX_AGE_MS;
}

/** The registry's `latest`, canonical, or nothing the nag can use. */
async function readLatest(response: Response): Promise<string | undefined> {
  if (!response.ok) {
    return undefined;
  }
  const parsed = registrySchema.safeParse(await response.json());
  if (!parsed.success) {
    return undefined;
  }
  const latest = parseSemver(parsed.data.version);
  return latest.ok ? formatSemver(latest.value) : undefined;
}

function buildNag(
  cliVersion: string,
  latest: string,
  env: UpdateCheckDeps["env"],
): string | undefined {
  const cliParse = parseSemver(cliVersion);
  const newestParse = parseSemver(latest);
  if (!cliParse.ok || !newestParse.ok) {
    return undefined;
  }
  const cli = cliParse.value;
  const newest = newestParse.value;
  const alreadyNewest = compareSemver(newest, cli) <= 0;
  if (alreadyNewest) {
    return undefined;
  }
  const canonical = formatSemver(newest);
  const command = buildUpdateCommand(canonical, detectLaunchForm(env));
  return `A new version of ${PACKAGE_NAME} is available: ${formatSemver(cli)} → ${canonical}. To update, run: ${command}`;
}

const INERT: UpdateCheckHandle = { settle: () => undefined };

/** Start the check beside the command; inert for a dev build or under the opt-out. */
export function startUpdateCheck(deps: UpdateCheckDeps): UpdateCheckHandle {
  const optedOut = deps.env[NO_VERSION_WARNING_ENV] !== undefined;
  const devBuild = isDevVersion(deps.cliVersion);
  if (optedOut || devBuild) {
    return INERT;
  }
  const now = deps.now ?? Date.now;
  const cached = readCache(deps.cacheDir);
  const owed =
    cached !== undefined &&
    !cached.notified &&
    buildNag(deps.cliVersion, cached.latest, deps.env) !== undefined;

  let settledLatest: string | undefined;
  let controller: AbortController | undefined;
  const stale = !isFresh(cached, now());
  if (stale) {
    controller = new AbortController();
    const timer = setTimeout(
      () => controller?.abort(),
      UPDATE_CHECK_TIMEOUT_MS,
    );
    timer.unref();
    const check = async (signal: AbortSignal): Promise<void> => {
      try {
        const response = await deps.fetch(NPM_REGISTRY_LATEST_URL, { signal });
        settledLatest = await readLatest(response);
      } catch {
        // A failed or aborted check is silent; the cache stays as it was.
      } finally {
        clearTimeout(timer);
      }
    };
    void check(controller.signal);
  }

  function settleAnswer(
    latest: string,
    succeeded: boolean,
  ): string | undefined {
    const nag =
      owed && succeeded
        ? buildNag(deps.cliVersion, latest, deps.env)
        : undefined;
    writeCache(deps.cacheDir, {
      latest,
      checkedAt: new Date(now()).toISOString(),
      notified: nag !== undefined,
    });
    return nag;
  }

  function settleCached(succeeded: boolean): string | undefined {
    if (cached === undefined || !owed || !succeeded) {
      return undefined;
    }
    const nag = buildNag(deps.cliVersion, cached.latest, deps.env);
    if (nag !== undefined) {
      writeCache(deps.cacheDir, { ...cached, notified: true });
    }
    return nag;
  }

  return {
    settle(succeeded) {
      if (settledLatest !== undefined) {
        return settleAnswer(settledLatest, succeeded);
      }
      controller?.abort();
      return settleCached(succeeded);
    },
  };
}
