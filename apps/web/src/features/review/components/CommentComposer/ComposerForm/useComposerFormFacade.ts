import { RequestBounds } from "contract";
import { useTranslation } from "react-i18next";
import { useCallback, useRef, useState } from "react";

import { dropOrphanedPlaceholders } from "@web/components/MarkdownTextarea/useAttachmentUpload";
import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import type { CommentAnchor } from "../../../utils/comments";
import {
  readUnsavedCommentText,
  writeUnsavedCommentText,
  type UnsavedCommentKey,
} from "../unsaved-text-storage";

export interface ComposerFormFacade {
  body: string;
  /** The text is held in the tab's storage, so navigation cannot lose it. */
  persisted: boolean;
  error: string;
  onBodyChange: (value: string) => void;
  /** A failed image upload lands in the same inline surface as a submit refusal. */
  failAttach: (copy: string) => void;
  submit: () => void;
  /** The reviewer's Cancel: the unsaved text goes with the composer. */
  discard: () => void;
}

interface SeededText {
  body: string;
  droppedUpload: boolean;
  /** What storage held at mount, before any dead placeholder was dropped. */
  stored: string;
}

function seedUnsavedText(key: UnsavedCommentKey | undefined): SeededText {
  if (key === undefined) {
    return { body: "", droppedUpload: false, stored: "" };
  }
  const stored = readUnsavedCommentText(key);
  const restored = dropOrphanedPlaceholders(stored);
  return { body: restored.text, droppedUpload: restored.droppedUpload, stored };
}

/**
 * Facade hook holding the composer's text and submit validation; the
 * markdown-editing affordances live in the shared MarkdownTextarea. With a
 * key, the text writes through to the tab's storage as it is typed, so it
 * outlives the composer being replaced or its host going away. The text is
 * read once, at mount: the form remounts per key.
 */
export function useComposerFormFacade(
  anchor: CommentAnchor,
  save: (anchor: CommentAnchor, body: string) => Promise<boolean>,
  unsavedTextKey?: UnsavedCommentKey,
): ComposerFormFacade {
  const { t } = useTranslation();
  const [seeded] = useState(() => seedUnsavedText(unsavedTextKey));
  const [body, setBody] = useState(seeded.body);
  const [error, setError] = useState(() =>
    seeded.droppedUpload ? t("review.comment.uploadNotRestored") : "",
  );
  const [persisted, setPersisted] = useState(unsavedTextKey !== undefined);
  // Storage can lag the body: a dropped placeholder, or a write it refused.
  const storedText = useRef(seeded.stored);

  const saveAndDispose = async (
    key: UnsavedCommentKey | undefined,
    sent: string,
    storedAtSave: string,
  ) => {
    let saved = false;
    try {
      saved = await save(anchor, sent);
    } catch (failure) {
      // The store has already reopened the composer holding its text.
      console.error(failure);
      return;
    }
    // Capture-at-initiation: text stored after the save started stays.
    const unchanged =
      key !== undefined && readUnsavedCommentText(key) === storedAtSave;
    const landedUnchanged = saved && unchanged;
    if (landedUnchanged) {
      writeUnsavedCommentText(key, "");
    }
  };

  // Stable: the composer's window Escape listener keys on `discard`.
  const writeBody = useCallback(
    (value: string) => {
      setBody(value);
      if (unsavedTextKey === undefined) {
        return;
      }
      const held = writeUnsavedCommentText(unsavedTextKey, value);
      if (held) {
        storedText.current = value;
      }
      setPersisted(held);
    },
    [unsavedTextKey],
  );
  const discard = useCallback(() => writeBody(""), [writeBody]);

  return {
    body,
    persisted,
    error,
    onBodyChange: (value) => {
      writeBody(value);
      setError("");
    },
    failAttach: setError,
    discard,
    submit: () => {
      const trimmed = body.trim();
      if (!trimmed) {
        setError(t("review.announce.commentEmpty"));
        return;
      }
      if (trimmed.length > RequestBounds.BODY_LENGTH) {
        setError(
          t("review.comment.tooLongToSave", { max: RequestBounds.BODY_LENGTH }),
        );
        return;
      }
      if (anchor.file.length > RequestBounds.PATH_LENGTH) {
        setError(t("review.comment.pathTooLongToSave"));
        return;
      }
      // The body would carry the placeholder, not the image.
      if (hasUploadPlaceholder(body)) {
        setError(t("shell.attach.waitForUpload"));
        return;
      }
      void saveAndDispose(unsavedTextKey, body, storedText.current);
    },
  };
}
