const JWT_SEGMENT_COUNT = 3;

function isJsonObjectSegment(segment: string): boolean {
  try {
    const decoded = Buffer.from(segment, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    const isObject = typeof parsed === "object" && parsed !== null;
    return isObject;
  } catch {
    return false;
  }
}

export function isJwt(match: string): boolean {
  const segments = match.split(".");
  const [header = "", payload = ""] = segments;
  const isThreeSegments = segments.length === JWT_SEGMENT_COUNT;
  const isJwtShape =
    isThreeSegments &&
    isJsonObjectSegment(header) &&
    isJsonObjectSegment(payload);
  return isJwtShape;
}

/** Escapes whose last char is a token char: `\n`, `%22`, `\u0022`, `\x22`. */
export const ESCAPE_BEFORE_TOKEN = String.raw`\\[nrt]|%[0-9A-Fa-f]{2}|\\u[0-9A-Fa-f]{4}|\\x[0-9A-Fa-f]{2}`;

/** A token pattern that starts where no token char precedes it, or right after an escape. */
export function buildTokenPattern(body: string, tokenChars: string): RegExp {
  return new RegExp(
    String.raw`(?<=^|[^${tokenChars}]|${ESCAPE_BEFORE_TOKEN})(?:${body})(?![${tokenChars}])`,
    "g",
  );
}
