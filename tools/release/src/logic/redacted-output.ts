import type { Writable } from "node:stream";

type WriteCallback = (error?: Error | null) => void;

// Greedy up to the last `@` before the path, so a password holding `@` is
// redacted whole.
const URL_USERINFO_ALL = /:\/\/[^/\s]+@/g;
const REDACTED_USERINFO = "://<redacted>@";

function redactUrlCredentials(text: string): string {
  return text.replace(URL_USERINFO_ALL, REDACTED_USERINFO);
}

function redactChunk(chunk: string | Uint8Array): string | Uint8Array {
  if (typeof chunk === "string") {
    return redactUrlCredentials(chunk);
  }
  return chunk;
}

/**
 * Every string written to `stream` from here on has its URL userinfo
 * redacted, so a usage error, a refusal or a crash report that echoes an
 * argument never prints a credential.
 */
export function redactStreamOutput(stream: Writable): void {
  const write = stream.write.bind(stream);
  function writeRedacted(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | WriteCallback,
    callback?: WriteCallback,
  ): boolean {
    const redacted = redactChunk(chunk);
    if (typeof encodingOrCallback === "function") {
      return write(redacted, encodingOrCallback);
    }
    if (encodingOrCallback === undefined) {
      return write(redacted, callback);
    }
    return write(redacted, encodingOrCallback, callback);
  }
  stream.write = writeRedacted;
}

/** What a crash prints: the stack when there is one, with URL userinfo redacted. */
export function describeCrash(cause: unknown): string {
  const text =
    cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
  return redactUrlCredentials(text);
}
