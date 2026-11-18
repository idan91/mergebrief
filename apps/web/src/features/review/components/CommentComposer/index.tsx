import type { MentionSource } from "@web/features/conversation/types";
import type { CommentAnchor } from "../../utils/comments";
import { getComposerHost, useReviewFlow } from "../../session";
import { ComposerForm } from "./ComposerForm";
import { buildUnsavedCommentKey } from "./unsaved-text-storage";

export interface CommentComposerProps {
  anchor: CommentAnchor;
  cancel: () => void;
  /** Where mention suggestions come from; absent turns mentions off. */
  mentionSource?: MentionSource | undefined;
  /** Answers whether the draft landed; the composer clears its text on success. */
  save: (anchor: CommentAnchor, body: string) => Promise<boolean>;
  /** The staged-draft write is in flight; the composer closes when it lands. */
  saving?: boolean | undefined;
}

/** Each place keeps its own text, so a composer moved to other lines remounts on theirs. */
export function CommentComposer({
  anchor,
  cancel,
  mentionSource,
  save,
  saving,
}: CommentComposerProps) {
  const briefId = useReviewFlow((state) => state.briefId);
  const host = useReviewFlow((state) => getComposerHost(state.composer));
  const unsavedTextKey =
    briefId === undefined
      ? undefined
      : buildUnsavedCommentKey(briefId, anchor, host);

  return (
    <ComposerForm
      anchor={anchor}
      cancel={cancel}
      key={unsavedTextKey}
      mentionSource={mentionSource}
      save={save}
      saving={saving}
      unsavedTextKey={unsavedTextKey}
    />
  );
}
