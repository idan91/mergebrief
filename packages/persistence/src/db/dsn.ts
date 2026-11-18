// DATABASE_URL_FILE resolution, for exactly this one variable and NOT a
// generic `*_FILE` mechanism: compose `secrets:` mounts land as files, and a
// connection string in a file never shows up in `docker inspect`. The file
// wins over a plain `DATABASE_URL` with a warning naming the shadowed
// variable, since silent precedence leaves an operator debugging the wrong
// value.
import { readFileSync } from "node:fs";
import type { Result } from "types/utils";

export interface ResolveDsnOptions {
  /** File reader (throws on unreadable). Default: `fs.readFileSync` utf-8. */
  readonly readFile?: (path: string) => string;
  /** Sink for the shadow warning. Omitted = dropped (callers on a boot path
   * should pass their logger's `warn`). */
  readonly onWarning?: (message: string) => void;
}

/**
 * Resolve the effective `DATABASE_URL` value from the env pair. Returns the
 * file content (trimmed: secret files routinely carry a trailing newline)
 * when `DATABASE_URL_FILE` is set, else the plain variable (which may be
 * `undefined`; the caller's schema owns the required-ness error). An
 * unreadable file is an expected boot failure: the issue names the PATH (an
 * operator pointer, not a credential) but never any file content.
 */
export function resolveDatabaseUrl(
  env: Record<string, string | undefined>,
  options: ResolveDsnOptions = {},
): Result<string | undefined, string> {
  const filePath = env["DATABASE_URL_FILE"]?.trim();
  if (filePath === undefined || filePath.length === 0) {
    return { ok: true, value: env["DATABASE_URL"] };
  }

  const readFile =
    options.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  let content: string;
  try {
    content = readFile(filePath);
  } catch (cause) {
    // The reader's message embeds the path, never the content, so it is safe to echo.
    const reason = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      error: `DATABASE_URL_FILE: cannot read file — ${reason}`,
    };
  }

  // Empty-string DATABASE_URL (e.g. compose interpolation of an unset var)
  // carries no value to shadow: warn only when a real value is ignored.
  const shadowed = env["DATABASE_URL"];
  if (shadowed !== undefined && shadowed.length > 0) {
    options.onWarning?.(
      "DATABASE_URL_FILE is set and takes precedence — the DATABASE_URL environment variable is ignored",
    );
  }
  return { ok: true, value: content.trim() };
}
