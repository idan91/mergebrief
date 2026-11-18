// Start mounts a server-function transport under this base whether or not an
// app defines one. This app defines none (the lint bans `createServerFn`), so
// nothing legitimate ever asks for it, and closing it removes the transport's
// whole attack surface, a reflected XSS in some Start versions included.
import "@tanstack/react-start/server-only";

/** Start's `TSS_SERVER_FN_BASE` is `/_serverFn/`; vite.config keeps it. */
const SERVER_FUNCTION_BASE = "/_serverFn";
const LAST_C0_CONTROL = 0x1f;
const DELETE_CHARACTER = 0x7f;

function containsControlCharacter(text: string): boolean {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code <= LAST_C0_CONTROL || code === DELETE_CHARACTER) {
      return true;
    }
  }
  return false;
}

function decodePath(pathname: string): string | undefined {
  try {
    return decodeURI(pathname);
  } catch {
    return undefined;
  }
}

/**
 * Start decodes a path and strips its control characters before it matches
 * the base, so `/_serverFn%00/x` reaches the transport. A path that will not
 * decode, or carries a control character, is refused wherever it points:
 * nothing legitimate sends either.
 */
function isMalformedPath(pathname: string): boolean {
  const decoded = decodePath(pathname);
  if (decoded === undefined) {
    return true;
  }
  return containsControlCharacter(decoded);
}

/** Decoded the way Start decodes it, so `/%5FserverFn/x` matches too. */
function isServerFunctionPath(pathname: string): boolean {
  const decoded = decodePath(pathname) ?? "";
  const isBase = decoded === SERVER_FUNCTION_BASE;
  const isUnderBase = decoded.startsWith(`${SERVER_FUNCTION_BASE}/`);
  const isServerFunction = isBase || isUnderBase;
  return isServerFunction;
}

/** The paths the server entry answers 404 before Start sees them. */
export function isRefusedPath(pathname: string): boolean {
  const refused = isMalformedPath(pathname) || isServerFunctionPath(pathname);
  return refused;
}
