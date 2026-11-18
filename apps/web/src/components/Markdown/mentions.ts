import { MentionPatterns } from "contract";
import type { Element, ElementContent, Text } from "hast";
import { SKIP, visit } from "unist-util-visit";

import {
  MentionCandidateKinds,
  type MentionCandidateKind,
} from "@web/components/MarkdownTextarea/types";
import type { RehypeTransform } from "./types";

export interface MentionMatch {
  /** Offset of the `@`. */
  readonly start: number;
  readonly end: number;
  /** `login` or `org/slug`, as written. */
  readonly target: string;
  readonly kind: MentionCandidateKind;
}

// Never after a word character, so `a@b.com` stays an address, and never
// running on into one, so `@cara-x` is not a mention of `cara`. A login
// followed by a slash that starts no team, or by a dot that starts a word
// (`@alice/`, `@cara.github.io`), is no mention either, as on GitHub.
const MENTION_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_])@(${MentionPatterns.LOGIN})(?:/(${MentionPatterns.TEAM_SLUG})|(?!/))(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_])`,
  "g",
);

/** Text a mention never rewrites: code shows what was typed, a link already goes somewhere. */
const VERBATIM_TAGS: ReadonlySet<string> = new Set(["code", "pre", "a"]);

const MENTION_KINDS: ReadonlySet<unknown> = new Set(
  Object.values(MentionCandidateKinds),
);

export function isMentionKind(value: unknown): value is MentionCandidateKind {
  return MENTION_KINDS.has(value);
}

export function findMentions(text: string): readonly MentionMatch[] {
  const matches: MentionMatch[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const login = match[1];
    if (login === undefined) {
      continue;
    }

    const slug = match[2];
    const start = match.index;
    matches.push({
      start,
      end: start + match[0].length,
      target: slug === undefined ? login : `${login}/${slug}`,
      kind:
        slug === undefined
          ? MentionCandidateKinds.USER
          : MentionCandidateKinds.TEAM,
    });
  }

  return matches;
}

// Markdown source a mention never rewrites, as the renderer skips it: a code
// span or fence, a link or image, an autolink, and a bare URL. No branch
// scans past the next delimiter, so text any participant writes stays linear.
const SOURCE_VERBATIM_PATTERN =
  /(`{1,8})[^`]*?\1|!?\[[^[\]\n]*\]\([^()\n]*\)|<[^\s<>]+>|\b(?:https?:\/\/|www\.)\S+/gi;

interface TextRange {
  readonly start: number;
  readonly end: number;
}

function isRangeBeforeMention(
  range: TextRange | undefined,
  mention: MentionMatch,
): boolean {
  const before = range !== undefined && range.end <= mention.start;
  return before;
}

/**
 * The mentions in markdown source shown as plain text, leaving out those
 * the renderer would leave as typed.
 */
export function findSourceMentions(text: string): readonly MentionMatch[] {
  const verbatim: TextRange[] = [];
  for (const match of text.matchAll(SOURCE_VERBATIM_PATTERN)) {
    verbatim.push({ start: match.index, end: match.index + match[0].length });
  }

  // Both lists run in text order, so one pass skips every covered mention.
  const kept: MentionMatch[] = [];
  let next = 0;
  for (const mention of findMentions(text)) {
    let range = verbatim[next];
    while (isRangeBeforeMention(range, mention)) {
      next += 1;
      range = verbatim[next];
    }
    const covered = range !== undefined && range.start <= mention.start;
    if (!covered) {
      kept.push(mention);
    }
  }

  return kept;
}

/** A run of text; `mention` is set when the run is one. */
export interface MentionTextPart {
  readonly text: string;
  readonly mention?: MentionMatch;
}

/** The text cut into plain runs and mentions, in reading order. */
export function splitMentionText(
  text: string,
  mentions: readonly MentionMatch[] = findMentions(text),
): readonly MentionTextPart[] {
  const parts: MentionTextPart[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) {
      parts.push({ text: text.slice(cursor, mention.start) });
    }
    parts.push({ text: text.slice(mention.start, mention.end), mention });
    cursor = mention.end;
  }
  if (cursor < text.length) {
    parts.push({ text: text.slice(cursor) });
  }

  return parts;
}

function buildMentionNode(part: MentionTextPart): ElementContent {
  if (part.mention === undefined) {
    return { type: "text", value: part.text };
  }

  const { target, kind } = part.mention;
  const element: Element = {
    type: "element",
    tagName: "span",
    properties: { dataMention: target, dataMentionKind: kind },
    children: [{ type: "text", value: part.text }],
  };
  return element;
}

function splitMentions(node: Text): ElementContent[] | undefined {
  const parts = splitMentionText(node.value);
  if (!parts.some((part) => part.mention !== undefined)) {
    return undefined;
  }

  const nodes = parts.map(buildMentionNode);
  return nodes;
}

/**
 * Marks every mention in a body's text as a span the renderer can resolve.
 * Runs after sanitize, so only text people wrote is split, never markup.
 */
export function rehypeMarkMentions(): RehypeTransform {
  return (tree) => {
    visit(tree, (node, index, parent) => {
      const isVerbatim =
        node.type === "element" && VERBATIM_TAGS.has(node.tagName);
      if (isVerbatim) {
        return SKIP;
      }

      const isSplittableText =
        node.type === "text" && parent !== undefined && index !== undefined;
      if (!isSplittableText) {
        return undefined;
      }

      const parts = splitMentions(node);
      if (parts === undefined) {
        return undefined;
      }

      parent.children.splice(index, 1, ...parts);
      const nextIndex = index + parts.length;
      return [SKIP, nextIndex];
    });
  };
}
