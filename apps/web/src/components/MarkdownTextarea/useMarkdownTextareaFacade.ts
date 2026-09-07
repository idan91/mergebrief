import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

import {
  applyLinePrefix,
  applyLinkTemplate,
  applyMarkdownWrap,
  applyOrderedListPrefix,
  continueListOnEnter,
  indentListSelection,
  replaceSelectionWithSuggestion,
  type TextEdit,
} from "./utils";
import type { ToolbarIconKey } from "./icons";
import { MarkdownTextareaModes, type MarkdownTextareaMode } from "./types";
import { useTranslation } from "react-i18next";

export interface ToolbarAction {
  icon: ToolbarIconKey;
  label: string;
  /** Tooltip; includes the shortcut where one exists. */
  title: string;
  run: () => void;
}

export interface MarkdownTextareaFacade {
  mode: MarkdownTextareaMode;
  setMode: (mode: MarkdownTextareaMode) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  toolbarActions: ToolbarAction[];
  onTextareaKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
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
}: MarkdownTextareaFacadeArgs): MarkdownTextareaFacade {
  const { t } = useTranslation();
  const [mode, setMode] = useState<MarkdownTextareaMode>(
    MarkdownTextareaModes.WRITE,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  /** Applies the edit unless read-only or the edit declines (null). */
  function applyMaybeTextEdit(
    edit: (text: string, start: number, end: number) => TextEdit | null,
  ): boolean {
    if (readOnly) return false;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const next = edit(value, start, end);
    if (next === null) return false;
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
    toolbarActions,
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
