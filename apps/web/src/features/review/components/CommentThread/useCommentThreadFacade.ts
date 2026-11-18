import { RequestBounds } from "contract";
import { useTranslation } from "react-i18next";
import { useRef, useState } from "react";

import { hasUploadPlaceholder } from "@web/components/MarkdownTextarea/utils";
import type { ReviewComment } from "../../utils/comments";
import { useReviewActions } from "../../session";
import { ThreadModeKinds, type ThreadMode } from "./types";

export interface UseCommentThreadFacadeInput {
  comment: ReviewComment;
  /** Only a draft is the reviewer's to change; anything else stays read-only. */
  readOnly: boolean;
  posting: boolean;
  update: (commentId: string, body: string) => Promise<boolean>;
}

const VIEWING: ThreadMode = { kind: ThreadModeKinds.VIEW };

/**
 * The draft card's edit and delete-confirm flow. An edit closes when its
 * write LANDS: a failure leaves the editor open holding its text with Save
 * still available, and nothing but the write moves while it is in flight.
 */
export function useCommentThreadFacade({
  comment,
  readOnly,
  posting,
  update,
}: UseCommentThreadFacadeInput) {
  const { t } = useTranslation();
  const { announce } = useReviewActions();
  const [mode, setMode] = useState<ThreadMode>(VIEWING);
  const [body, setBody] = useState(comment.body);
  // An upload failure or a refused save; a save waits for zero uploads.
  const [editError, setEditError] = useState<string | undefined>(undefined);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const editing = mode.kind === ThreadModeKinds.EDITING;
  const saving = mode.kind === ThreadModeKinds.EDITING && mode.saving;
  const editorOpen = editing && !readOnly;
  const confirmDeleteOpen =
    mode.kind === ThreadModeKinds.CONFIRMING_DELETE && !readOnly;

  // Focus inside the editor moves to Edit before the editor unmounts, so it
  // never drops to the page body.
  const releaseEditorFocus = () => {
    const focusInEditor =
      editorRef.current?.contains(document.activeElement) === true;
    if (focusInEditor) {
      editTriggerRef.current?.focus();
    }
  };
  const closeEditor = () => {
    releaseEditorFocus();
    setMode(VIEWING);
  };
  const editBody = (next: string) => {
    setBody(next);
    setEditError(undefined);
  };
  // Save keeps the posting guard: an editor already open when a Post starts
  // must not save mid-flight (capture-at-initiation).
  const saveEdit = async () => {
    const writeInFlight = posting || saving;
    if (writeInFlight) {
      return;
    }
    // The body would carry the placeholder, not the image.
    if (hasUploadPlaceholder(body)) {
      setEditError(t("shell.attach.waitForUpload"));
      return;
    }
    const trimmed = body.trim();
    if (trimmed === "") {
      setEditError(t("review.announce.commentEmpty"));
      return;
    }
    if (trimmed.length > RequestBounds.BODY_LENGTH) {
      setEditError(
        t("review.comment.tooLongToSave", { max: RequestBounds.BODY_LENGTH }),
      );
      return;
    }
    const savingMode: ThreadMode = {
      kind: ThreadModeKinds.EDITING,
      saving: true,
    };
    setMode(savingMode);
    let updated = false;
    try {
      updated = await update(comment.id, body);
    } catch (failure) {
      // A throw is a failed write: the editor reopens holding its text.
      console.error(failure);
    }
    // Either settle applies only while this save's mode is current.
    if (updated) {
      releaseEditorFocus();
      setMode((current) => (current === savingMode ? VIEWING : current));
      return;
    }
    setMode((current) =>
      current === savingMode
        ? { kind: ThreadModeKinds.EDITING, saving: false }
        : current,
    );
  };
  const cancelEdit = () => {
    if (saving) {
      return;
    }
    setBody(comment.body);
    setEditError(undefined);
    closeEditor();
  };
  const openEditor = () => {
    // An open editor keeps its text: Edit only brings the reviewer back to it.
    if (editing) {
      editorRef.current?.querySelector("textarea")?.focus();
      return;
    }
    // Seed the editor from the current comment each time, so an edit never
    // opens on a stale body if it changed since mount.
    setBody(comment.body);
    setMode({ kind: ThreadModeKinds.EDITING, saving: false });
  };
  const requestDelete = () => {
    if (editorOpen) {
      announce(t("review.comment.deleteWhileEditing"));
      return;
    }
    setMode({ kind: ThreadModeKinds.CONFIRMING_DELETE });
  };
  const keepDraft = () => {
    setMode(VIEWING);
    deleteTriggerRef.current?.focus();
  };
  /** A confirmation must not resurface on a later expand without fresh intent. */
  const dropDeleteConfirm = () => {
    if (mode.kind === ThreadModeKinds.CONFIRMING_DELETE) {
      setMode(VIEWING);
    }
  };

  return {
    body,
    editError,
    editing,
    saving,
    editorOpen,
    confirmDeleteOpen,
    deleteTriggerRef,
    editTriggerRef,
    editorRef,
    setEditError,
    editBody,
    saveEdit: () => void saveEdit(),
    cancelEdit,
    openEditor,
    requestDelete,
    keepDraft,
    dropDeleteConfirm,
  };
}
