import { describe, expect, it } from "vitest";
import {
  ReviewCommentSides,
  ReviewVerdictStates as GithubReviewVerdictStates,
  ThreadSubjectTypes as GithubThreadSubjectTypes,
  type ConversationAuthor as GithubConversationAuthor,
  type ConversationComment as GithubConversationComment,
  type ConversationReview as GithubConversationReview,
  type ConversationThread as GithubConversationThread,
  type PrComment as GithubPrComment,
  type PrConversation as GithubPrConversation,
} from "github";
import type { Equals } from "types/utils";
import {
  ReviewVerdictStates,
  ThreadSides,
  ThreadSubjectTypes,
  type ConversationAuthor,
  type ConversationComment,
  type ConversationReview,
  type ConversationThread,
  type PrConversation,
  type PrLevelComment,
} from "./types";

interface VocabularyPin {
  readonly label: string;
  readonly mirror: Readonly<Record<string, string>>;
  readonly source: Readonly<Record<string, string>>;
}

const VOCABULARY_PINS: readonly VocabularyPin[] = [
  {
    label: "ThreadSides",
    mirror: ThreadSides,
    source: ReviewCommentSides,
  },
  {
    label: "ThreadSubjectTypes",
    mirror: ThreadSubjectTypes,
    source: GithubThreadSubjectTypes,
  },
  {
    label: "ReviewVerdictStates",
    mirror: ReviewVerdictStates,
    source: GithubReviewVerdictStates,
  },
];

/**
 * EXACT per-interface shape pins. `Equals` compares key sets AND property
 * types AND modifiers, catching what mutual assignability cannot: an OPTIONAL
 * field renamed or retyped. One pin per nested interface, so a failure names
 * the shape that drifted instead of the whole envelope.
 */
const SHAPE_PINS = {
  ConversationAuthor: true satisfies Equals<
    ConversationAuthor,
    GithubConversationAuthor
  >,
  ConversationComment: true satisfies Equals<
    ConversationComment,
    GithubConversationComment
  >,
  ConversationThread: true satisfies Equals<
    ConversationThread,
    GithubConversationThread
  >,
  ConversationReview: true satisfies Equals<
    ConversationReview,
    GithubConversationReview
  >,
  PrLevelComment: true satisfies Equals<PrLevelComment, GithubPrComment>,
  PrConversation: true satisfies Equals<PrConversation, GithubPrConversation>,
} as const;

describe("conversation vocabulary matches its github source", () => {
  // This module mirrors the github package's `PrConversation` domain shape,
  // and nothing structurally couples the two; CI's per-package path filter
  // does not run this suite when `packages/github` changes. These pins import
  // the source at dev time (never in the client bundle) so either side moving
  // turns the other red.
  it.each(VOCABULARY_PINS)(
    "$label equals its github source map",
    ({ mirror, source }) => {
      // `toEqual` forgives declaration order but catches a renamed key, a
      // dropped member, and a changed wire literal.
      expect({ ...mirror }).toEqual({ ...source });
    },
  );

  it.each(Object.entries(SHAPE_PINS))(
    "%s matches github keys, types, and modifiers",
    (_shape, pinned) => {
      // The pin itself is compile-time (typecheck includes test files); this
      // asserts each one is present, so a pin cannot be silently deleted.
      expect(pinned).toBe(true);
    },
  );
});
