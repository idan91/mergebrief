import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";

import { activeMentionQuery, insertMention } from "./utils";

const MAX_MENTION_OPTIONS = 5;

export interface MentionAutocomplete {
  open: boolean;
  options: readonly string[];
  activeIndex: number;
  listId: string;
  optionId: (index: number) => string;
  /** id of the highlighted option, for aria-activedescendant. */
  activeOptionId: string | undefined;
  /** Report the caret position (from change/select events). */
  onCaretMove: (caret: number) => void;
  /** Close the popup when the textarea loses focus. */
  onBlur: () => void;
  /**
   * Popup keyboard handling; returns true when the event was consumed —
   * callers must then skip their own keydown handling.
   */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  select: (login: string) => void;
}

export interface MentionAutocompleteArgs {
  value: string;
  onChange: (value: string) => void;
  candidates: readonly string[];
  /** A read-only surface is inert — the popup must not open or insert. */
  readOnly: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  baseId: string;
}

/**
 * `@`-mention autocomplete over an injected candidate pool (BRIEF-56
 * decision 7: participants-seeded; the source widens — collaborators
 * endpoint — without touching this hook). Combobox-with-listbox keyboard
 * contract; suppressed inside code fences.
 */
export function useMentionAutocomplete({
  value,
  onChange,
  candidates,
  readOnly,
  textareaRef,
  baseId,
}: MentionAutocompleteArgs): MentionAutocomplete {
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Escape parks the popup for the mention being typed (keyed by its `@`
  // position); a new `@` elsewhere reopens.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Focus loss closes the popup; any caret report (typing, clicking back
  // in) clears the latch.
  const [blurred, setBlurred] = useState(false);

  const mention =
    candidates.length > 0 && !readOnly
      ? activeMentionQuery(value, caret)
      : null;
  const query = mention?.query.toLowerCase() ?? "";
  const options =
    mention === null
      ? []
      : candidates
          .filter((candidate) => candidate.toLowerCase().startsWith(query))
          .slice(0, MAX_MENTION_OPTIONS);
  const open =
    mention !== null &&
    options.length > 0 &&
    !blurred &&
    dismissedAt !== mention.start;

  // Highlight resets when the query narrows the list under it.
  const clampedIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
  // An Escape dismissal lasts for the mention's continuous life: once no
  // mention is being typed, forget it — the same position typed fresh
  // must reopen.
  useEffect(() => {
    if (mention === null && dismissedAt !== null) setDismissedAt(null);
  }, [mention, dismissedAt]);

  const listId = `${baseId}-mentions`;
  const optionId = (index: number) => `${listId}-${index}`;

  const select = (login: string) => {
    if (mention === null) return;
    const next = insertMention(value, mention.start, caret, login);
    onChange(next.text);
    setCaret(next.selectionStart);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(
        next.selectionStart,
        next.selectionEnd,
      );
    }, 0);
  };

  return {
    open,
    options,
    activeIndex: clampedIndex,
    listId,
    optionId,
    activeOptionId: open ? optionId(clampedIndex) : undefined,
    onCaretMove: (position) => {
      setBlurred(false);
      setCaret(position);
    },
    onBlur: () => setBlurred(true),
    onKeyDown: (event) => {
      if (!open) return false;
      // IME candidate-list keys are never popup commands.
      if (event.nativeEvent.isComposing) return false;
      // Modified Enter belongs to the editor (Cmd+Enter submits WHAT THE
      // USER SEES; Shift+Enter is the plain-newline escape hatch) — the
      // popup must neither insert nor swallow it.
      if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey || event.shiftKey)
      ) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(
          (clampedIndex + delta + options.length) % options.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const login = options[clampedIndex];
        if (login === undefined) return false;
        event.preventDefault();
        select(login);
        return true;
      }
      if (event.key === "Escape") {
        // Dismiss the popup only — the editor's own Escape semantics
        // (cancel edit, blur reply) must not fire on the same keystroke.
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(mention?.start ?? null);
        return true;
      }
      return false;
    },
    select,
  };
}
