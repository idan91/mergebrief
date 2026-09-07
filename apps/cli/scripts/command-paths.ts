// The set of command paths the REAL commander program registers, so the
// mapping gate can reject a map entry naming a command that no longer exists.
// Deps are throwing stubs: building the program must never touch the network,
// disk, or stdin.
import type { Command } from "commander";
import { buildProgram, type CliDeps } from "../src/program";

const INERT_DEPS: CliDeps = {
  fetch: async () => {
    throw new Error("enumerating commands must not fetch");
  },
  env: {},
  configDir: "/nonexistent",
  cacheDir: "/nonexistent",
  stdout: () => undefined,
  stderr: () => undefined,
  readStdin: async () => {
    throw new Error("enumerating commands must not read stdin");
  },
  gitOriginUrl: () => undefined,
};

/** Every registered path, subcommands included: `pr`, `auth`, `auth login`. */
export function collectCommandPaths(command: Command): ReadonlySet<string> {
  const paths = new Set<string>();
  const walk = (parent: Command, prefix: readonly string[]): void => {
    for (const child of parent.commands) {
      const path = [...prefix, child.name()];
      paths.add(path.join(" "));
      walk(child, path);
    }
  };
  walk(command, []);
  return paths;
}

export function cliCommandPaths(): ReadonlySet<string> {
  return collectCommandPaths(buildProgram(INERT_DEPS));
}
