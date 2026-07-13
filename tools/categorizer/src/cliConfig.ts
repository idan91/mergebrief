/**
 * Extract `--config <path>` (explicit instance config — the CLIs honor NO
 * ambient MERGEBRIEF_CONFIG, per BRIEF-11 decision 6) and return the rest of
 * argv. Null when the flag is present but its value is missing/flag-shaped.
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
