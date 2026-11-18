/** `name` without `suffix`, or `undefined` when it does not end with it. */
export function stripSuffix(name: string, suffix: string): string | undefined {
  if (!name.endsWith(suffix)) {
    return undefined;
  }
  return name.slice(0, -suffix.length);
}
