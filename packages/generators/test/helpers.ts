/** The request URL, whatever shape `fetch` was handed. */
export function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
