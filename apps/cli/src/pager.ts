// `$PAGER` for `diff` on a terminal; cosmetics only, so a pager that cannot run
// does not cost the reader the diff, and none costs the command its exit code.
import type { spawn } from "node:child_process";

/** What a shell exits with when it could not run the command at all. */
const SHELL_CANNOT_EXECUTE = 126;
const SHELL_COMMAND_NOT_FOUND = 127;

export interface PagerOptions {
  readonly spawn: typeof spawn;
  readonly command: string;
  /** Shows the diff when no pager could run. */
  readonly writeFallback: (text: string) => void;
}

function isPagerUnrunnable(code: number | null): boolean {
  return code === SHELL_CANNOT_EXECUTE || code === SHELL_COMMAND_NOT_FOUND;
}

export function createPager(
  options: PagerOptions,
): (text: string) => Promise<void> {
  const { command, writeFallback } = options;
  return (text) =>
    new Promise((resolve) => {
      const child = options.spawn(command, {
        shell: true,
        stdio: ["pipe", "inherit", "inherit"],
      });
      child.on("close", (code) => {
        if (isPagerUnrunnable(code)) {
          writeFallback(text);
        }
        resolve();
      });
      child.on("error", () => {
        writeFallback(text);
        resolve();
      });
      // A pager that quits early is the reader closing early: no message, and
      // the command keeps its exit code. `close` still settles the promise.
      child.stdin.on("error", () => undefined);
      child.stdin.end(text);
    });
}
