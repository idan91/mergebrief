import { useTranslation } from "react-i18next";
import { useState } from "react";

import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import type { CommentAnchor } from "../../utils/comments";

export interface CommentComposerFacade {
  body: string;
  error: string;
  onBodyChange: (value: string) => void;
  /** A failed image upload lands in the same inline surface as a submit refusal. */
  failAttach: (copy: string) => void;
  submit: () => void;
}

/**
 * Facade hook holding the CommentComposer's draft state and submit
 * validation; the markdown-editing affordances live in the shared
 * MarkdownTextarea.
 */
export function useCommentComposerFacade(
  anchor: CommentAnchor,
  save: (anchor: CommentAnchor, body: string) => void,
): CommentComposerFacade {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  return {
    body,
    error,
    onBodyChange: (value) => {
      setBody(value);
      setError("");
    },
    failAttach: setError,
    submit: () => {
      if (!body.trim()) {
        setError(t("review.announce.commentEmpty"));
        return;
      }
      // The body would carry the placeholder, not the image.
      if (hasUploadPlaceholder(body)) {
        setError(t("shell.attach.waitForUpload"));
        return;
      }
      save(anchor, body);
    },
  };
}
