import { stringify } from "yaml";
import { RepoConfigPaths } from "../src/constants";
import type { RepoConfigFileInput } from "../src/validate";

/** A file input with a deterministic fake blob SHA. */
export function file(
  path: string,
  content: string,
  blobSha = "sha-fake",
): RepoConfigFileInput {
  return { path, content, blobSha };
}

export function settingsFile(content: string): RepoConfigFileInput {
  return file(RepoConfigPaths.SETTINGS, content);
}

export function policyFile(content: string): RepoConfigFileInput {
  return file(RepoConfigPaths.POLICY, content);
}

export function instructionsFile(content: string): RepoConfigFileInput {
  return file(RepoConfigPaths.INSTRUCTIONS, content);
}

/** Serialize a value to YAML — exercises the real parse path in validate. */
export function yaml(value: unknown): string {
  return stringify(value);
}

/**
 * Pad a valid ASCII YAML document with a trailing comment line so its UTF-8
 * byte length is exactly `target`. The comment is ignored by both the YAML
 * parser and the strict schema (comments are not keys).
 */
export function padYamlToBytes(base: string, target: number): string {
  const withNewline = base.endsWith("\n") ? base : `${base}\n`;
  const prefix = "# ";
  const current = Buffer.byteLength(withNewline + prefix, "utf8");
  const needed = target - current;
  if (needed < 0)
    throw new Error(`base (${current} bytes) already exceeds target ${target}`);
  return withNewline + prefix + "x".repeat(needed);
}
