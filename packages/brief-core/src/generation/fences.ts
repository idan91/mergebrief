/**
 * Every tag the prompt uses to fence untrusted data. Injected text is
 * stripped of the whole union, so no snippet can close its own fence or open
 * another's.
 */
export const KNOWN_FENCE_TAGS = [
  "linked_context",
  "repo_instructions",
  "repo_custom_attributes",
  "review_comment",
  "anchor_brief",
] as const;

/** The two tags a PR could forge to impersonate default-branch config. */
export const REPO_FENCE_TAGS = [
  "repo_instructions",
  "repo_custom_attributes",
] as const;

/** Length of the `<` or `</` plus tag that starts `candidate`, else 0. */
function matchTagPrefix(candidate: string, tags: readonly string[]): number {
  if (!candidate.startsWith("<")) return 0;
  const closing = candidate.startsWith("</");
  const lead = closing ? 2 : 1;
  const rest = candidate.slice(lead).toLowerCase();
  const tag = tags.find((name) => rest.startsWith(name));
  return tag === undefined ? 0 : lead + tag.length;
}

/**
 * Remove every opening or closing occurrence of the given tags in one pass.
 * A removal can join its neighbours into a new tag
 * (`<linked_<linked_contextcontext`), so after each removal the output's tail
 * is re-checked against the remaining input; every re-check consumes text, so
 * the walk stays linear however deep the nesting.
 */
export function stripFenceTags(text: string, tags: readonly string[]): string {
  const lowered = tags.map((tag) => tag.toLowerCase());
  const window = Math.max(...lowered.map((tag) => tag.length)) + 2;
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    const char = text.charAt(i);
    if (char !== "<") {
      out.push(char);
      i += 1;
      continue;
    }
    const skip = matchTagPrefix(text.slice(i, i + window), lowered);
    if (skip === 0) {
      out.push(char);
      i += 1;
      continue;
    }
    i += skip;
    i = skipJoinedTags(out, text, i, lowered, window);
  }

  return out.join("");
}

/** Index of the last `<` within the final `window` chars of `out`, else -1. */
function findOpenWithin(out: readonly string[], window: number): number {
  const floor = Math.max(0, out.length - window);
  for (let j = out.length - 1; j >= floor; j -= 1) {
    if (out[j] === "<") return j;
  }
  return -1;
}

/**
 * A removal can make the kept tail of `out` and the next input spell a tag
 * (`<linked_` + `context>` after the inner tag of `<linked_<linked_context>context>`
 * goes). Drop each such tag and return the input index to resume from.
 */
function skipJoinedTags(
  out: string[],
  text: string,
  start: number,
  tags: readonly string[],
  window: number,
): number {
  let i = start;
  let lastOpen = findOpenWithin(out, window);
  while (lastOpen !== -1) {
    const tail = out.slice(lastOpen).join("");
    const skip = matchTagPrefix(tail + text.slice(i, i + window), tags);
    if (skip === 0) return i;

    out.length = lastOpen;
    if (skip < tail.length) {
      out.push(...tail.slice(skip).split(""));
      return i;
    }
    i += skip - tail.length;
    lastOpen = findOpenWithin(out, window);
  }
  return i;
}

/**
 * The strip for injected data. Applied to the rendered fence body AND to the
 * quote-verification corpus, which must stay byte-identical views of the same
 * text.
 */
export function stripKnownFences(text: string): string {
  return stripFenceTags(text, KNOWN_FENCE_TAGS);
}

/** Fence-attribute values: keep them inert inside a quoted XML-ish attribute. */
export function attributeSafe(value: string): string {
  return value.replace(/["<>\\]/g, "");
}
