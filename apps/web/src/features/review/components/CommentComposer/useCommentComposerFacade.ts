import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

import {
  applyMarkdownWrap,
  replaceSelectionWithSuggestion,
  type CommentAnchor,
} from "../../utils/comments";

export type ComposerMode = "write" | "preview";

interface TextEdit {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface CommentComposerFacade {
  body: string;
  mode: ComposerMode;
  setMode: (mode: ComposerMode) => void;
  error: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onBodyChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  wrapBold: () => void;
  wrapItalic: () => void;
  wrapCode: () => void;
  insertQuote: () => void;
  insertList: () => void;
  insertOrderedList: () => void;
  insertTask: () => void;
  insertLink: () => void;
  insertSuggestion: () => void;
  submit: () => void;
}

/**
 * Facade hook holding the CommentComposer's markdown-editing logic (selection
 * maths, toolbar inserts, keyboard shortcuts) so the component stays a thin view.
 */
export function useCommentComposerFacade(
  anchor: CommentAnchor,
  save: (anchor: CommentAnchor, body: string) => void,
): CommentComposerFacade {
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<ComposerMode>("write");
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function applyTextEdit(
    edit: (text: string, start: number, end: number) => TextEdit,
  ) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const next = edit(body, start, end);
    setBody(next.text);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
      );
    }, 0);
  }

  function insertLinePrefix(prefix: string) {
    applyTextEdit((text, start, end) => {
      const selected = text.slice(start, end) || "list item";
      const replacement = selected
        .split("\n")
        .map((line) => `${prefix}${line}`)
        .join("\n");
      return {
        text: `${text.slice(0, start)}${replacement}${text.slice(end)}`,
        selectionStart: start,
        selectionEnd: start + replacement.length,
      };
    });
  }

  function insertLink() {
    applyTextEdit((text, start, end) => {
      const selected = text.slice(start, end) || "link text";
      const replacement = `[${selected}](https://example.com)`;
      return {
        text: `${text.slice(0, start)}${replacement}${text.slice(end)}`,
        selectionStart: start + 1,
        selectionEnd: start + 1 + selected.length,
      };
    });
  }

  function wrap(marker: string) {
    applyTextEdit((text, start, end) =>
      applyMarkdownWrap(text, start, end, marker),
    );
  }

  return {
    body,
    mode,
    setMode,
    error,
    textareaRef,
    onBodyChange: (value) => {
      setBody(value);
      setError("");
    },
    onKeyDown: (event) => {
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
    wrapBold: () => wrap("**"),
    wrapItalic: () => wrap("_"),
    wrapCode: () => wrap("`"),
    insertQuote: () => insertLinePrefix("> "),
    insertList: () => insertLinePrefix("- "),
    insertOrderedList: () => insertLinePrefix("1. "),
    insertTask: () => insertLinePrefix("- [ ] "),
    insertLink,
    insertSuggestion: () =>
      applyTextEdit((text, start, end) =>
        replaceSelectionWithSuggestion(
          text,
          start,
          end,
          text.slice(start, end) || anchor.selectedText,
        ),
      ),
    submit: () => {
      if (!body.trim()) {
        setError("Comment cannot be empty.");
        return;
      }
      save(anchor, body);
    },
  };
}
