/**
 * Parses, and carries a scheme a browser puts in an `Origin` header. Embedded
 * credentials are refused: the value is posted in GitHub comments as a link.
 */
export function isHttpUrl(value: string): boolean {
  const parses = URL.canParse(value);
  if (!parses) {
    return false;
  }

  const { protocol, username, password } = new URL(value);
  const isHttp = protocol === "http:" || protocol === "https:";
  const hasCredentials = username !== "" || password !== "";
  const isPlainHttpUrl = isHttp && !hasCredentials;
  return isPlainHttpUrl;
}
