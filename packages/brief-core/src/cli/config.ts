/**
 * Extract `--config <path>` (explicit instance config — the CLIs honor no
 * ambient MERGEBRIEF_CONFIG) and return the rest of argv. Null when the flag is
 * present but its value is missing or flag-shaped.
 */
export function extractConfigFlag(
  args: string[],
): { configPath: string | null; rest: string[] } | null {
  const index = args.indexOf("--config");
  if (index === -1) return { configPath: null, rest: args };
  const configPath = args[index + 1];
  // Any hyphen-leading value is flag-shaped, not a path ("-x" included).
  if (configPath === undefined || configPath.startsWith("-")) return null;
  return {
    configPath,
    rest: [...args.slice(0, index), ...args.slice(index + 2)],
  };
}

/**
 * Pull `--context <file>` out of the argv, the same shape as `--config`: the
 * file supplies the primary ticket's text without a tracker read.
 */
export function extractContextFlag(
  args: string[],
): { contextPath: string | null; rest: string[] } | null {
  const index = args.indexOf("--context");
  if (index === -1) return { contextPath: null, rest: args };
  const contextPath = args[index + 1];
  if (contextPath === undefined || contextPath.startsWith("-")) return null;
  return {
    contextPath,
    rest: [...args.slice(0, index), ...args.slice(index + 2)],
  };
}

/**
 * Pull `--out <dir>` out of the argv, the same shape as `--config`: absent is
 * `null` (the caller's default), a flag-shaped or missing value is `null` for
 * the whole parse so the CLI prints usage rather than writing somewhere odd.
 */
export function extractOutFlag(
  args: string[],
): { outDir: string | null; rest: string[] } | null {
  const index = args.indexOf("--out");
  if (index === -1) return { outDir: null, rest: args };
  const outDir = args[index + 1];
  if (outDir === undefined || outDir.startsWith("-")) return null;
  return {
    outDir,
    rest: [...args.slice(0, index), ...args.slice(index + 2)],
  };
}
