export function stripUrlQuery(url: string): string {
  const queryStart = url.search(/[?#]/);
  if (queryStart === -1) {
    return url;
  }
  return url.slice(0, queryStart);
}
