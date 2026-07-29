import { useState } from "react";

import type { CommentAnchor } from "../../utils/comments";

export interface CommentComposerFacade {
  body: string;
  error: string;
  onBodyChange: (value: string) => void;
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
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  return {
    body,
    error,
    onBodyChange: (value) => {
      setBody(value);
      setError("");
    },
    submit: () => {
      if (!body.trim()) {
        setError("Comment cannot be empty.");
        return;
      }
      save(anchor, body);
    },
  };
}
