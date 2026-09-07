export function readHome(
  env: Record<string, string | undefined>,
): string | undefined {
  return env["HOME"];
}

export const cwd = process.cwd();
export const platform = process.platform;
