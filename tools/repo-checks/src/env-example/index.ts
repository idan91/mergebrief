import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Result } from "types/utils";

import type { TrackedText } from "../types";
import {
  ENV_EXAMPLE_PATH,
  ENV_KEY_EXEMPTIONS,
  ENV_KEY_SHAPE,
  ENV_PARSER_PATHS,
  ENV_READ_FORMS,
  ENV_READER_PATHSPECS,
  ENV_READER_PATTERN,
  ENV_READER_SKIPS,
  PASS_VARS_LIST,
  QUOTED_KEY,
} from "./consts";
import type {
  EnvExampleGaps,
  EnvExampleInput,
  EnvKeyGap,
  EnvReaderGaps,
  EnvReaderInput,
} from "./types";

/** The env keys one parser source reads, sorted. */
export function extractEnvKeys(source: string): string[] {
  const keys = new Set<string>();
  for (const form of ENV_READ_FORMS) {
    for (const found of source.matchAll(form)) {
      const key = found[1];
      if (key !== undefined && ENV_KEY_SHAPE.test(key)) {
        keys.add(key);
      }
    }
  }
  for (const list of source.matchAll(PASS_VARS_LIST)) {
    for (const quoted of (list[1] ?? "").matchAll(QUOTED_KEY)) {
      const key = quoted[1];
      if (key !== undefined && ENV_KEY_SHAPE.test(key)) {
        keys.add(key);
      }
    }
  }
  return [...keys].toSorted();
}

export function findUnlistedEnvReaders(input: EnvReaderInput): EnvReaderGaps {
  const parsers = new Set(input.parsers);
  const readers = new Set(input.readers);
  const unlisted = input.readers.filter(
    (path) => !parsers.has(path) && !input.skips.has(path),
  );
  const staleSkips = [...input.skips.keys()].filter(
    (path) => !readers.has(path),
  );
  return { unlisted: unlisted.toSorted(), staleSkips: staleSkips.toSorted() };
}

/** Tracked server sources that mention the environment; git grep reads source pathspecs only. */
function listEnvReaders(root: string): Result<string[], string> {
  const run = spawnSync(
    "git",
    ["grep", "-lE", ENV_READER_PATTERN, "--", ...ENV_READER_PATHSPECS],
    { cwd: root, encoding: "utf8" },
  );
  // git grep exits 1 when nothing matches, which is a valid empty answer.
  if (run.status !== 0 && run.status !== 1) {
    return { ok: false, error: `git grep failed: ${run.stderr.trim()}` };
  }
  return {
    ok: true,
    value: run.stdout.split("\n").filter((line) => line !== ""),
  };
}

function mentionsKey(example: string, key: string): boolean {
  const mention = new RegExp(`(?<![A-Z0-9_])${key}(?![A-Z0-9_])`);
  return mention.test(example);
}

export function findEnvExampleGaps(
  input: EnvExampleInput,
): Pick<EnvExampleGaps, "missing" | "staleExemptions"> {
  const readers = new Map<string, string[]>();
  for (const { path, text } of input.parsers) {
    for (const key of extractEnvKeys(text)) {
      const paths = readers.get(key) ?? [];
      paths.push(path);
      readers.set(key, paths);
    }
  }

  const missing: EnvKeyGap[] = [];
  const byKey = [...readers].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [key, paths] of byKey) {
    const documented = mentionsKey(input.example, key);
    if (!documented && !input.exemptions.has(key)) {
      missing.push({ key, paths });
    }
  }
  const staleExemptions = [...input.exemptions.keys()].filter(
    (key) => !readers.has(key),
  );
  return { missing, staleExemptions };
}

function readRepoFile(root: string, path: string): Result<string, string> {
  try {
    return { ok: true, value: readFileSync(join(root, path), "utf8") };
  } catch {
    return { ok: false, error: `cannot read ${path}` };
  }
}

/** Reads `.env.example` and the listed parsers under `root`, nothing else. */
export function checkEnvExample(root: string): Result<EnvExampleGaps, string> {
  const example = readRepoFile(root, ENV_EXAMPLE_PATH);
  if (!example.ok) {
    return example;
  }

  const parsers: TrackedText[] = [];
  for (const path of ENV_PARSER_PATHS) {
    const text = readRepoFile(root, path);
    if (!text.ok) {
      return text;
    }
    parsers.push({ path, text: text.value });
  }

  const readers = listEnvReaders(root);
  if (!readers.ok) {
    return readers;
  }
  const keyGaps = findEnvExampleGaps({
    parsers,
    example: example.value,
    exemptions: ENV_KEY_EXEMPTIONS,
  });
  const readerGaps = findUnlistedEnvReaders({
    readers: readers.value,
    parsers: ENV_PARSER_PATHS,
    skips: ENV_READER_SKIPS,
  });
  return {
    ok: true,
    value: {
      ...keyGaps,
      unlistedReaders: readerGaps.unlisted,
      staleReaderSkips: readerGaps.staleSkips,
    },
  };
}
