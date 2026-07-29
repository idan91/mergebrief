import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

import {
  applyLinePrefix,
  applyLinkTemplate,
  applyMarkdownWrap,
  replaceSelectionWithSuggestion,
  type TextEdit,
} from "./utils";
import type { ToolbarIconKey } from "./icons";

export type MarkdownTextareaMode = "write" | "preview";

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
   * a mid-flight mutation would diverge from what the pending request ships
   * (capture-at-initiation rule).
   */
  readOnly: boolean;
  /**
   * Pre-fill for the Insert-suggestion action (the anchored lines' text).
   * The action only exists when this is provided — suggestions are
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
  const [mode, setMode] = useState<MarkdownTextareaMode>("write");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function applyTextEdit(
    edit: (text: string, start: number, end: number) => TextEdit,
  ) {
    if (readOnly) return;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const next = edit(value, start, end);
    onChange(next.text);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
      );
    }, 0);
  }

  const wrap = (marker: string) =>
    applyTextEdit((text, start, end) =>
      applyMarkdownWrap(text, start, end, marker),
    );
  const prefix = (linePrefix: string) =>
    applyTextEdit((text, start, end) =>
      applyLinePrefix(text, start, end, linePrefix),
    );
  const insertLink = () => applyTextEdit(applyLinkTemplate);

  const toolbarActions: ToolbarAction[] = [
    {
      icon: "bold",
      label: "Bold",
      title: "Bold (Ctrl/Cmd+B)",
      run: () => wrap("**"),
    },
    {
      icon: "italic",
      label: "Italic",
      title: "Italic (Ctrl/Cmd+I)",
      run: () => wrap("_"),
    },
    {
      icon: "code",
      label: "Inline code",
      title: "Inline code",
      run: () => wrap("`"),
    },
    { icon: "quote", label: "Quote", title: "Quote", run: () => prefix("> ") },
    {
      icon: "bulletedList",
      label: "Bulleted list",
      title: "Bulleted list",
      run: () => prefix("- "),
    },
    {
      icon: "numberedList",
      label: "Numbered list",
      title: "Numbered list",
      run: () => prefix("1. "),
    },
    {
      icon: "taskList",
      label: "Task list",
      title: "Task list",
      run: () => prefix("- [ ] "),
    },
    {
      icon: "link",
      label: "Link",
      title: "Link (Ctrl/Cmd+K)",
      run: insertLink,
    },
  ];
  if (suggestionSeed !== undefined) {
    toolbarActions.push({
      icon: "suggestion",
      label: "Insert suggestion",
      title: "Insert suggestion",
      run: () =>
        applyTextEdit((text, start, end) =>
          replaceSelectionWithSuggestion(
            text,
            start,
            end,
            text.slice(start, end) || suggestionSeed,
          ),
        ),
    });
  }

  return {
    mode,
    setMode,
    textareaRef,
    toolbarActions,
    onTextareaKeyDown: (event) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        wrap("**");
      } else if (key === "i") {
        event.preventDefault();
        wrap("_");
      } else if (key === "k") {
        event.preventDefault();
        insertLink();
      }
    },
  };
}
