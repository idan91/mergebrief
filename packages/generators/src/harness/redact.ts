import { GeneratorError, GeneratorErrorKinds } from "../contract/errors";
import type { HarnessRunResult } from "./run";

/**
 * Classified failure for a timer kill: which timer, how long, stderr tail.
 * Partial output goes to the adapter's failure dump, never the message.
 */
export function harnessTimeoutError(
  label: string,
  result: HarnessRunResult,
): GeneratorError {
  const which =
    result.timedOut === "hard"
      ? "hard wall-clock timeout"
      : "output-inactivity watchdog";
  // Redact BEFORE truncating: a slice boundary inside a credential could
  // strip the marker (e.g. "Bearer ") and leave a bare secret suffix.
  const tail = redactSecrets(result.stderrTail.trim()).slice(-500);
  const stderrNote = tail === "" ? "" : `; stderr tail: ${tail}`;
  return new GeneratorError(
    GeneratorErrorKinds.TIMEOUT,
    `${label}: ${which} fired after ${String(result.durationMs)}ms and the ` +
      `process was killed${stderrNote}`,
  );
}

/**
 * Untrusted third-party stderr: strip credential-shaped substrings before any
 * of it reaches an error message. No-secrets outranks diagnosability, and the
 * FULL tail still reaches failure dumps.
 */
export function redactSecrets(text: string): string {
  return (
    text
      // Scheme-carrying forms FIRST: `token: Bearer abc` must fall to the
      // Bearer rule whole, not have the assignment rule eat "Bearer" and
      // strand the credential. Authorization is taken whole because Digest
      // carries a comma-separated param list. ["']? admits JSON-shaped keys.
      .replace(
        /\b((?:proxy-)?authorization["']?\s*[=:]\s*)[^\n]+/gi,
        "$1(redacted)",
      )
      // Cookies carry credentials in arbitrary attr=value pairs the
      // assignment rule's name list cannot anticipate: take the whole line.
      .replace(/\b((?:set-)?cookie["']?\s*[=:]\s*)[^\n]+/gi, "$1(redacted)")
      .replace(/Bearer\s+\S+/gi, "Bearer (redacted)")
      // Standalone `Basic <credential>`. RFC 7235 schemes are case-insensitive
      // but the TOKEN check is not: an /i flag would match any 8+ lowercase
      // word. Requiring an encoded-looking token keeps prose like "Basic usage
      // failed" intact, while base64("user:pass") never survives.
      .replace(
        /\b([Bb][Aa][Ss][Ii][Cc])\s+(?=[A-Za-z0-9+/=]*[A-Z0-9+/=])[A-Za-z0-9+/=]{8,}(?![\w+/=])/g,
        "$1 (redacted)",
      )
      // Bare JWTs: segments are often too short for the length-based base64
      // rule, but the eyJ prefix (base64 of '{"') is unmistakable.
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "(redacted)")
      .replace(/(\w+:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1(redacted)@")
      .replace(
        // [\w-]* prefix matches AWS_ACCESS_KEY_ID and kin: underscores are
        // word chars, so \b alone would miss prefixed names. Quoted values
        // match BEFORE \S+ so password="hunter 2" is consumed to its closing
        // quote. ["']? after the name admits JSON keys: "password":"x".
        /([\w-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key(?:[_-]?id)?|client[_-]?secret|auth))["']?(\s*[=:]\s*)(?!Bearer \(redacted\))("[^"\n]*"|'[^'\n]*'|\S+)/gi,
        "$1$2(redacted)",
      )
      .replace(
        /([?&](?:api[_-]?key|token|key|secret|password)=)[^&\s]+/gi,
        "$1(redacted)",
      )
      .replace(/\b(sk|rk|pk)-[\w-]{8,}/g, "$1-(redacted)")
      .replace(/\b[0-9a-f]{24,}\b/gi, "(redacted)")
      .replace(/\b[A-Za-z0-9+/=_-]{40,}\b/g, "(redacted)")
  );
}
