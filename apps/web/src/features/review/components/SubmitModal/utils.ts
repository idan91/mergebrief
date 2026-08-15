export function shortFile(path: string): string {
  const parts = path.split("/");
  return parts.at(-1) ?? path;
}
