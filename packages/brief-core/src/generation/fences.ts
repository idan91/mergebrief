/**
 * Every tag the prompt uses to fence untrusted data. Injected text is
 * stripped of the whole union, so no snippet can close its own fence or open
 * another's.
 */
export const KNOWN_FENCE_TAGS = [
  "linked_context",
  "primary_ticket",
  "repo_instructions",
  "repo_custom_attributes",
  "review_comment",
  "anchor_brief",
  "pr_title",
  "pr_description",
  "pr_diff",
] as const;

/** The two tags a PR could forge to impersonate default-branch config. */
export const REPO_FENCE_TAGS = [
  "repo_instructions",
  "repo_custom_attributes",
] as const;

/** Any spelling a model reads as `<`: the bracket, its entities and its look-alikes. */
const OPENER_SOURCE =
  "(?:<|&lt;?|&#0*60;?|&#x0*3c;?|\\u02C2|\\u1438|\\u2039|\\u2329|\\u276E|\\u27E8|\\u3008|\\uFE64|\\uFF1C)";

/**
 * What may sit between the opener and the tag name. Diffs split on `\n` alone,
 * so every other break is gap; prose has no line contract and takes `\n` too.
 * One class per gap keeps the match linear.
 */
const LINE_GAP_CHARS =
  "\\t\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200F\\u2028\\u2029\\u202F\\u205F\\u2060\\u3000\\uFEFF/";
const PROSE_GAP_CHARS = `${LINE_GAP_CHARS}\\n`;

/**
 * Left where a tag was removed. It is no opener, gap or tag-name character,
 * so the text on either side can never join into a new tag.
 */
export const REMOVED_TAG_MARK = "\uFFFD";

function buildFencePattern(tags: readonly string[], gapChars: string): RegExp {
  const names = tags.map((tag) => tag.toLowerCase()).join("|");
  return new RegExp(`${OPENER_SOURCE}[${gapChars}]*(?:${names})`, "giu");
}

const KNOWN_FENCE_PATTERN = buildFencePattern(KNOWN_FENCE_TAGS, LINE_GAP_CHARS);
const KNOWN_PROSE_FENCE_PATTERN = buildFencePattern(
  KNOWN_FENCE_TAGS,
  PROSE_GAP_CHARS,
);

/** Keeps the line count, so it is safe on a diff. */
export function stripFenceTags(text: string, tags: readonly string[]): string {
  return text.replace(
    buildFencePattern(tags, LINE_GAP_CHARS),
    REMOVED_TAG_MARK,
  );
}

export function stripKnownFences(text: string): string {
  return text.replace(KNOWN_FENCE_PATTERN, REMOVED_TAG_MARK);
}

/** For text with no line contract: a tag split across a line break goes too. */
export function stripKnownProseFences(text: string): string {
  return text.replace(KNOWN_PROSE_FENCE_PATTERN, REMOVED_TAG_MARK);
}

/** Fence-attribute values: keep them inert inside a quoted XML-ish attribute. */
export function attributeSafe(value: string): string {
  return stripKnownFences(value.replace(/["<>\\]/g, ""));
}
