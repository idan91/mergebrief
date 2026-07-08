// One-liner derivation for digest rows (BRIEF-25 design consult): strip
// markdown to plain text → first non-empty prose line → cap ~80ch →
// fallback for code-only bodies. Heading, table, and code lines are
// DROPPED, not merely unmarked — otherwise bot digests render
// "## Walkthrough" garbage.

const MAX_DIGEST_LINE = 80;
const CODE_ONLY_FALLBACK = "suggested change";

/** A GFM table separator row: `---|---`, `:--- | :---:`, with/without pipes. */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Remove inline markdown, keeping the human-readable content. */
function stripInline(line: string): string {
  return (
    line
      // images before links (nested syntax): ![alt](url) → alt
      .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replaceAll(/`([^`]*)`/g, "$1")
      // Emphasis contents cannot be whitespace-flanked (spaced asterisks
      // are literal — codex round 10).
      .replaceAll(/\*\*(\S(?:.*?\S)?)\*\*/g, "$1")
      .replaceAll(/\*(\S(?:.*?\S)?)\*/g, "$1")
      // GFM does not emphasize intraword underscores (user_id, foo__bar__baz
      // stay intact): only delimiter pairs at word boundaries unwrap — the
      // double-underscore branch included (codex round 8).
      .replaceAll(/(?<![A-Za-z0-9_])__(.+?)__(?![A-Za-z0-9_])/g, "$1")
      .replaceAll(/(?<![A-Za-z0-9_])_(.+?)_(?![A-Za-z0-9_])/g, "$1")
      .replaceAll(/<\/?[a-zA-Z][^>]*>/g, "")
      .trim()
  );
}

/**
 * Derive the one-line digest text for a comment body. Never empty: bodies
 * that strip to nothing (code-only suggestions, image-only, tables) fall
 * back to a static label.
 */
export function deriveDigestLine(body: string): string {
  const rawLines = body.split("\n");
  // Fence state remembers the opener (char + length): a ```` fence legally
  // contains ``` lines and only a matching, >=-length marker closes it
  // (codex round 12).
  let fence: { char: string; length: number } | null = null;
  let inTable = false;
  for (const [index, rawLine] of rawLines.entries()) {
    // Quote markers unwrap FIRST so structural filters (headings, tables,
    // fences) apply inside blockquotes too — `> ## Walkthrough` is still a
    // heading (codex round 5).
    const line = rawLine.trim().replace(/^(>\s*)+/, "");
    // The structural lookahead must not read an INDENTED-CODE next line as
    // markdown structure (codex round 11): `    ---` after prose is code,
    // not a Setext underline.
    const nextRaw = rawLines[index + 1];
    const nextIsIndentedCode =
      nextRaw !== undefined &&
      (/^(\t| {4})/.test(nextRaw) ||
        /^(\t| {4})/.test(nextRaw.replace(/^ {0,3}(> ?)+/, "")));
    const next =
      nextRaw === undefined || nextIsIndentedCode
        ? undefined
        : nextRaw.trim().replace(/^(>\s*)+/, "");
    // Indent classifies BEFORE fences: an indented ``` is code content, not
    // a fence toggle (codex round 10). Both plain and quoted forms.
    const indentedCode =
      /^(\t| {4})/.test(rawLine) ||
      /^(\t| {4})/.test(rawLine.replace(/^ {0,3}(> ?)+/, ""));
    const fenceMatch = indentedCode ? null : /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (fenceMatch !== null && fenceMatch[1] !== undefined) {
      const marker = fenceMatch[1];
      const char = marker[0] ?? "`";
      const trailing = (fenceMatch[2] ?? "").trim();
      if (fence === null) {
        fence = { char, length: marker.length };
        continue;
      }
      // A CLOSER allows only trailing whitespace — ```ts inside an open
      // fence is content (codex round 13).
      if (
        char === fence.char &&
        marker.length >= fence.length &&
        trailing === ""
      ) {
        fence = null;
        continue;
      }
      // Fence-marker-looking content inside an open fence stays content.
      continue;
    }
    if (fence !== null) continue;
    if (line === "") {
      inTable = false;
      continue;
    }
    // Once a separator row opened a table, EVERY following line is a body
    // row until a blank line breaks the table (GFM continues pipe-less
    // single-cell rows too — codex round 6).
    if (inTable) continue;
    // Indented code blocks are code, not prose (rounds 6-7: plain indent
    // wins over quote reading; quote markers count after 0-3 spaces).
    if (indentedCode) continue;
    // Headings and table rows are structure, not content.
    if (/^#{1,6}\s/.test(line)) continue;
    // Separator check FIRST: a leading-pipe separator (`|---|---|`) must
    // still enter table mode so pipe-less body rows drop (codex round 2) —
    // but only a PIPED separator is a table; a bare `---` is a horizontal
    // rule and must not swallow following prose (codex round 3).
    if (TABLE_SEPARATOR.test(line)) {
      if (line.includes("|")) {
        inTable = true;
      }
      continue;
    }
    // A leading pipe is only a table row when a separator establishes the
    // table (GFM requires one) — otherwise it is prose (codex round 5).
    if (
      line.startsWith("|") &&
      next !== undefined &&
      TABLE_SEPARATOR.test(next)
    ) {
      continue;
    }
    if (line.startsWith("|") && inTable) continue;
    // A pipe-less table header reveals itself by its separator on the NEXT
    // line ("File | Summary" then "--- | ---").
    if (
      line.includes("|") &&
      next !== undefined &&
      TABLE_SEPARATOR.test(next)
    ) {
      continue;
    }
    // A Setext heading reveals itself the same way: text underlined by
    // `---`/`===` is a heading, and headings drop (codex round 4).
    if (next !== undefined && /^\s*(-+|=+)\s*$/.test(next)) {
      continue;
    }
    // Horizontal rules — and a bare `=` run (a consumed Setext underline).
    if (/^(-{3,}|\*{3,}|_{3,}|=+)$/.test(line)) continue;
    // Quote and list markers unwrap to their content.
    const unwrapped = stripInline(line.replace(/^([-*+]|\d+[.)])\s+/, ""));
    if (unwrapped === "") continue;
    if (unwrapped.length <= MAX_DIGEST_LINE) {
      return unwrapped;
    }
    return `${unwrapped.slice(0, MAX_DIGEST_LINE)}…`;
  }
  return CODE_ONLY_FALLBACK;
}
