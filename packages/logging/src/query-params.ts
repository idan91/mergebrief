import { QUERY_MESSAGE_PREFIX, redactQueryParams } from "./scrub";
import { isRecord } from "./utils";

/** Past this many causes the chain is left as it is; the string scrub still runs. */
const MAX_CAUSE_DEPTH = 8;

/** The props a query error carries its statement and bound values on. */
const QUERY_ERROR_PROPS: readonly string[] = ["query", "params"];

function isQueryError(error: Record<string, unknown>): boolean {
  return typeof error["query"] === "string" && "params" in error;
}

function readSafeMessage(
  error: Record<string, unknown>,
  message: string,
): string {
  const query = error["query"];
  if (!isQueryError(error)) {
    return redactQueryParams(message);
  }
  return typeof query === "string"
    ? `${QUERY_MESSAGE_PREFIX}${query}`
    : redactQueryParams(message);
}

interface SafeParts {
  readonly message: string;
  readonly safeMessage: string;
  readonly safeCause: unknown;
}

/** The same error class and props, so a serializer reads it as the original. */
function copyWithSafeParts(
  error: Record<string, unknown>,
  parts: SafeParts,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  Reflect.setPrototypeOf(copy, Reflect.getPrototypeOf(error));

  const dropped = isQueryError(error) ? QUERY_ERROR_PROPS : [];
  for (const [key, value] of Object.entries(error)) {
    if (!dropped.includes(key)) {
      copy[key] = value;
    }
  }

  const stack = error["stack"];
  const safeStack =
    typeof stack === "string"
      ? stack.replace(parts.message, parts.safeMessage)
      : undefined;
  Object.defineProperties(copy, {
    message: { value: parts.safeMessage, writable: true, configurable: true },
    stack: { value: safeStack, writable: true, configurable: true },
    cause: { value: parts.safeCause, writable: true, configurable: true },
  });
  return copy;
}

/**
 * An error whose message, stack and cause chain hold no bound query values.
 * The caller's error is never changed: one that holds none comes back as it
 * is, any other as a copy.
 */
export function removeQueryParams(error: unknown, depth = 0): unknown {
  if (depth > MAX_CAUSE_DEPTH) {
    return error;
  }
  if (!isRecord(error)) {
    return error;
  }
  const message = error["message"];
  if (typeof message !== "string") {
    return error;
  }

  const safeMessage = readSafeMessage(error, message);
  const cause = error["cause"];
  const safeCause = removeQueryParams(cause, depth + 1);
  const holdsNone = safeMessage === message && safeCause === cause;
  if (holdsNone) {
    return error;
  }

  return copyWithSafeParts(error, { message, safeMessage, safeCause });
}
