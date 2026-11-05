// The pager over real processes: a shell runs each command, as it does for `$PAGER`.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPager } from "../src/pager";

const LARGE_DIFF = "+line\n".repeat(1_000_000);

async function runPager(command: string, text: string): Promise<string[]> {
  const fallbacks: string[] = [];
  const page = createPager({
    spawn,
    command,
    writeFallback: (shown) => fallbacks.push(shown),
  });

  await page(text);
  return fallbacks;
}

describe("createPager", () => {
  it("hands a working pager the text as given and no fallback", async () => {
    const paged = join(mkdtempSync(join(tmpdir(), "mb-pager-")), "paged");

    const fallbacks = await runPager(`cat > "${paged}"`, "+plain\n");

    expect(readFileSync(paged, "utf8")).toBe("+plain\n");
    expect(fallbacks).toEqual([]);
  });

  it("survives a pager that quits before reading everything", async () => {
    const fallbacks = await runPager("head -c 1 > /dev/null", LARGE_DIFF);

    expect(fallbacks).toEqual([]);
  });

  it("shows the diff when the command does not exist", async () => {
    const fallbacks = await runPager(
      "mergebrief-no-such-pager 2>/dev/null",
      "+a\n",
    );

    expect(fallbacks).toEqual(["+a\n"]);
  });

  it("shows a large diff when the command does not exist", async () => {
    const fallbacks = await runPager(
      "mergebrief-no-such-pager 2>/dev/null",
      LARGE_DIFF,
    );

    expect(fallbacks).toHaveLength(1);
  });

  it("shows the diff when the command cannot be executed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "mb-pager-"));

    const fallbacks = await runPager(`"${directory}" 2>/dev/null`, "+a\n");

    expect(fallbacks).toEqual(["+a\n"]);
  });

  it("does not treat a pager's own failure as unrunnable", async () => {
    const fallbacks = await runPager("cat > /dev/null; exit 1", "+a\n");

    expect(fallbacks).toEqual([]);
  });
});
