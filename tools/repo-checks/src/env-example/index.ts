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
} from "./consts";
import type { EnvExampleGaps, EnvExampleInput, EnvKeyGap } from "./types";

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
  return [...keys].toSorted();
}

function mentionsKey(example: string, key: string): boolean {
  const mention = new RegExp(`(?<![A-Z0-9_])${key}(?![A-Z0-9_])`);
  return mention.test(example);
}

export function findEnvExampleGaps(input: EnvExampleInput): EnvExampleGaps {
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

  const gaps = findEnvExampleGaps({
    parsers,
    example: example.value,
    exemptions: ENV_KEY_EXEMPTIONS,
  });
  return { ok: true, value: gaps };
}
