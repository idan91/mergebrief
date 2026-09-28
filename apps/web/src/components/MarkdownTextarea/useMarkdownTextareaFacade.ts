import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";

import {
  applyLinePrefix,
  applyLinkTemplate,
  applyMarkdownWrap,
  applyOrderedListPrefix,
  continueListOnEnter,
  indentListSelection,
  readImageFiles,
  replaceSelectionWithSuggestion,
  type TextEdit,
} from "./utils";
import type { ToolbarIconKey } from "./icons";
import {
  MarkdownTextareaModes,
  type AttachDisabledReason,
  type MarkdownTextareaMode,
} from "./types";
import {
  adoptOrphanSettles,
  subscribeOrphanSettles,
  useAttachmentUpload,
} from "./useAttachmentUpload";
import { useTranslation } from "react-i18next";

export interface ToolbarAction {
  icon: ToolbarIconKey;
  label: string;
  /** Tooltip; includes the shortcut where one exists. */
  title: string;
  run: () => void;
  /** Off with a reason in the tooltip; the control stays focusable. */
  disabled?: boolean;
}

export interface MarkdownTextareaFacade {
  mode: MarkdownTextareaMode;
  setMode: (mode: MarkdownTextareaMode) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  toolbarActions: ToolbarAction[];
  /** Attaching is possible here; the footer names the branch. */
  canAttach: boolean;
  uploadsInFlight: number;
  attachFiles: (files: Iterable<File>) => void;
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onTextareaDrop: (event: DragEvent<HTMLTextAreaElement>) => void;
  onTextareaDragOver: (event: DragEvent<HTMLTextAreaElement>) => void;
}

export interface MarkdownTextareaFacadeArgs {
  value: string;
  onChange: (value: string) => void;
  /**
   * A read-only surface must be INERT, not just visually locked: toolbar
   * clicks and formatting shortcuts still fire on a read-only textarea, and
   * a mid-flight mutation would diverge from what the pending request ships.
   */
  readOnly: boolean;
  /**
   * Pre-fill for the Insert-suggestion action (the anchored lines' text).
   * The action only exists when this is provided, suggestions are
   * meaningless off a diff anchor.
   */
  suggestionSeed?: string | undefined;
  /** The page live region an upload's failure reports to. */
  announce?: ((message: string) => void) | undefined;
  /** The live region without its toast, for the in-flight start. */
  announceQuietly?: ((message: string) => void) | undefined;
  /** The consumer's inline surface for a failed upload. */
  onAttachError?: ((copy: string) => void) | undefined;
}

const ATTACH_DISABLED_TITLE_KEYS = {
  "no-scope": "shell.attach.noScope",
  "not-installed": "shell.attach.notInstalled",
  refused: "shell.attach.refused",
  "no-permission": "shell.attach.noPermission",
} as const satisfies Record<AttachDisabledReason, string>;

function readCommonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

/**
 * Facade hook holding the markdown-editing logic (selection maths, toolbar
 * actions, keyboard shortcuts) so MarkdownTextarea stays a thin view.
 */
export function useMarkdownTextareaFacade({
  value,
  onChange,
  readOnly,
  suggestionSeed,
  announce,
  announceQuietly,
  onAttachError,
}: MarkdownTextareaFacadeArgs): MarkdownTextareaFacade {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MarkdownTextareaMode>(
    MarkdownTextareaModes.WRITE,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // The upload settles against the text as it is THEN, not as it was when
  // the file was dropped: typing meanwhile must survive the swap.
  const valueRef = useRef(value);
  valueRef.current = value;
  // An upload that settles after this instance is gone must not write a
  // value captured before the owner moved on; the hook keeps that settle
  // for whichever instance next holds the placeholder, this one included
  // once it is back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const adopt = () => {
      const edit = adoptOrphanSettles(valueRef.current);
      if (edit !== null) {
        valueRef.current = edit.text;
        onChange(edit.text);
      }
    };
    adopt();
    const unsubscribe = subscribeOrphanSettles(adopt);
    return () => {
      mounted.current = false;
      unsubscribe();
    };
    // `onChange` is the owner's setter; a new identity must not re-adopt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Writes a settle into the value while keeping the writer's caret where
   * it is: the swap changes the text's length above the caret, so the
   * selection shifts by that much and is put back once React has set the
   * new value, which alone would park the caret at the end.
   */
  function applySettleEdit(next: TextEdit, previous: string): void {
    const textarea = textareaRef.current;
    const focused = textarea !== null && document.activeElement === textarea;
    const changedAt = readCommonPrefixLength(previous, next.text);
    const delta = next.text.length - previous.length;
    const start = textarea?.selectionStart ?? 0;
    const end = textarea?.selectionEnd ?? 0;
    valueRef.current = next.text;
    onChange(next.text);
    if (!focused) {
      return;
    }
    const shift = (position: number) =>
      position >= changedAt ? Math.max(changedAt, position + delta) : position;
    window.setTimeout(() => {
      textareaRef.current?.setSelectionRange(shift(start), shift(end));
    }, 0);
  }

  /** Applies the edit unless read-only or the edit declines (null). */
  function applyMaybeTextEdit(
    edit: (text: string, start: number, end: number) => TextEdit | null,
  ): boolean {
    if (readOnly) return false;
    // The ref, not the render-time value: two edits inside one event (a
    // multi-file drop) must each start from the text the last one wrote.
    const current = valueRef.current;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? current.length;
    const end = textarea?.selectionEnd ?? current.length;
    const next = edit(current, start, end);
    if (next === null) return false;
    valueRef.current = next.text;
    onChange(next.text);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
      );
    }, 0);
    return true;
  }

  function applyTextEdit(
    edit: (text: string, start: number, end: number) => TextEdit,
  ) {
    applyMaybeTextEdit(edit);
  }

  const upload = useAttachmentUpload({
    applyEdit: applyMaybeTextEdit,
    applyValueEdit: (edit) => {
      if (!mounted.current) {
        return false;
      }
      const previous = valueRef.current;
      const next = edit(previous);
      if (next === null) {
        // Declined: the writer took the placeholder out, nothing to settle.
        return true;
      }
      applySettleEdit(next, previous);
      return true;
    },
    readOnly,
    announce,
    announceQuietly,
    onAttachError,
  });
  const canAttach = upload.disabledReason === undefined && !readOnly;

  const wrap = (marker: string) =>
    applyTextEdit((text, start, end) =>
      applyMarkdownWrap(text, start, end, marker),
    );
  const prefix = (linePrefix: string) =>
    applyTextEdit((text, start, end) =>
      applyLinePrefix(text, start, end, linePrefix),
    );
  const insertLink = () =>
    applyTextEdit((text, start, end) => applyLinkTemplate(t, text, start, end));

  const toolbarActions: ToolbarAction[] = [
    {
      icon: "bold",
      label: t("shell.markdownToolbar.bold"),
      title: t("shell.markdownToolbar.boldTitle"),
      run: () => wrap("**"),
    },
    {
      icon: "italic",
      label: t("shell.markdownToolbar.italic"),
      title: t("shell.markdownToolbar.italicTitle"),
      run: () => wrap("_"),
    },
    {
      icon: "code",
      label: t("shell.markdownToolbar.inlineCode"),
      title: t("shell.markdownToolbar.inlineCode"),
      run: () => wrap("`"),
    },
    {
      icon: "quote",
      label: t("shell.markdownToolbar.quote"),
      title: t("shell.markdownToolbar.quote"),
      run: () => prefix("> "),
    },
    {
      icon: "bulletedList",
      label: t("shell.markdownToolbar.bulletedList"),
      title: t("shell.markdownToolbar.bulletedList"),
      run: () => prefix("- "),
    },
    {
      icon: "numberedList",
      label: t("shell.markdownToolbar.numberedList"),
      title: t("shell.markdownToolbar.numberedList"),
      run: () => applyTextEdit(applyOrderedListPrefix),
    },
    {
      icon: "taskList",
      label: t("shell.markdownToolbar.taskList"),
      title: t("shell.markdownToolbar.taskList"),
      run: () => prefix("- [ ] "),
    },
    {
      icon: "link",
      label: t("shell.markdownToolbar.link"),
      title: t("shell.markdownToolbar.linkTitle"),
      run: insertLink,
    },
    {
      icon: "image",
      label: t("shell.markdownToolbar.attachImage"),
      title:
        upload.disabledReason === undefined
          ? t("shell.markdownToolbar.attachImage")
          : t(ATTACH_DISABLED_TITLE_KEYS[upload.disabledReason]),
      disabled: upload.disabledReason !== undefined,
      run: () => {
        if (readOnly || upload.disabledReason !== undefined) {
          return;
        }
        fileInputRef.current?.click();
      },
    },
  ];
  const insertSuggestion =
    suggestionSeed !== undefined
      ? () =>
          applyTextEdit((text, start, end) =>
            replaceSelectionWithSuggestion(
              text,
              start,
              end,
              text.slice(start, end) || suggestionSeed,
            ),
          )
      : undefined;
  if (insertSuggestion !== undefined) {
    toolbarActions.push({
      icon: "suggestion",
      label: t("shell.markdownToolbar.insertSuggestion"),
      title: t("shell.markdownToolbar.insertSuggestionTitle"),
      run: insertSuggestion,
    });
  }

  return {
    mode,
    setMode,
    textareaRef,
    fileInputRef,
    toolbarActions,
    canAttach,
    uploadsInFlight: upload.inFlight,
    attachFiles: upload.attach,
    // An image on the clipboard is attached; anything else (text, a mixed
    // paste) stays the browser's, including a paste that carries both.
    onTextareaPaste: (event) => {
      if (!canAttach) {
        return;
      }
      const images = readImageFiles(event.clipboardData);
      if (images.length === 0 || event.clipboardData.getData("text/plain")) {
        return;
      }
      event.preventDefault();
      upload.attach(images);
    },
    onTextareaDrop: (event) => {
      if (!canAttach) {
        return;
      }
      const images = readImageFiles(event.dataTransfer);
      if (images.length === 0) {
        return;
      }
      event.preventDefault();
      // A drop adds a line; it never replaces a selection the writer left.
      const textarea = textareaRef.current;
      if (textarea !== null) {
        textarea.setSelectionRange(
          textarea.selectionEnd,
          textarea.selectionEnd,
        );
      }
      upload.attach(images);
    },
    // Without this the browser navigates to the dropped file.
    onTextareaDragOver: (event) => {
      if (canAttach) {
        event.preventDefault();
      }
    },
    onTextareaKeyDown: (event) => {
      // A keydown that commits/cancels an IME candidate must never be
      // treated as an editor command (Enter would splice the list marker
      // into a half-composed candidate).
      if (event.nativeEvent.isComposing) return;
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Enter") {
        // Cmd/Ctrl+Enter bubbles to the root submit handler; Shift+Enter is
        // the escape hatch (always a plain newline, via the browser
        // default); bare Enter continues a list item.
        if (!meta && !event.shiftKey) {
          if (applyMaybeTextEdit(continueListOnEnter)) event.preventDefault();
        }
        return;
      }
      if (event.key === "Tab" && !meta && !event.altKey) {
        // Indent/outdent only inside a list, everywhere else Tab must keep
        // its default focus-move behavior (keyboard users need the exit).
        const direction = event.shiftKey ? "outdent" : "indent";
        if (
          applyMaybeTextEdit((text, start, end) =>
            indentListSelection(text, start, end, direction),
          )
        ) {
          event.preventDefault();
        }
        return;
      }
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        wrap("**");
      } else if (key === "i") {
        event.preventDefault();
        wrap("_");
      } else if (key === "e") {
        event.preventDefault();
        wrap("`");
      } else if (key === "k") {
        event.preventDefault();
        insertLink();
      } else if (key === "g" && insertSuggestion !== undefined) {
        event.preventDefault();
        insertSuggestion();
      }
    },
  };
}
