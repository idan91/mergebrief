import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import type { MentionCandidate, MentionSuggestions } from "./types";
import {
  activeMentionQuery,
  filterByHandlePrefix,
  insertMention,
  readMentionHandle,
} from "./utils";

const MAX_MENTION_OPTIONS = 5;

/** The newest answer taken for the mention being typed. */
interface AdoptedSuggestions {
  readonly query: string;
  readonly candidates: readonly MentionCandidate[];
  /** The answer object itself, so one answer is taken once. */
  readonly source: MentionSuggestions;
}

export interface MentionAutocomplete {
  open: boolean;
  options: readonly MentionCandidate[];
  activeIndex: number;
  listId: string;
  optionId: (index: number) => string;
  /** id of the highlighted option, for aria-activedescendant. */
  activeOptionId: string | undefined;
  /** The open list is waiting on the caller's answer. */
  searching: boolean;
  /** Report the caret position (from change/select events). */
  onCaretMove: (caret: number) => void;
  /** Close the popup when the textarea loses focus. */
  onBlur: () => void;
  /**
   * Popup keyboard handling; returns true when the event was consumed;
   * callers must then skip their own keydown handling.
   */
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  select: (candidate: MentionCandidate) => void;
}

export interface MentionAutocompleteArgs {
  value: string;
  onChange: (value: string) => void;
  candidates: readonly MentionCandidate[];
  /** Present, the caller answers the reported query and `candidates` is unused. */
  suggestions: MentionSuggestions | undefined;
  onQueryChange: ((query: string | undefined) => void) | undefined;
  /** A read-only surface is inert: the popup must not open or insert. */
  readOnly: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  baseId: string;
}

/**
 * `@`-mention autocomplete. With a candidate pool, filtering is prefix on
 * the handle in POOL ORDER; the caller's ordering IS the ranking. With
 * caller suggestions, the list is the caller's answer to the reported
 * query, shown as given. Combobox-with-listbox keyboard contract;
 * suppressed inside code fences.
 */
export function useMentionAutocomplete({
  value,
  onChange,
  candidates,
  suggestions,
  onQueryChange,
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

  const enabled =
    !readOnly && (suggestions !== undefined || candidates.length > 0);
  const mention = enabled ? activeMentionQuery(value, caret) : null;
  const query = mention?.query;

  // The caller learns the query once per change, through the latest
  // callback; a new callback identity alone reports nothing.
  const onQueryChangeRef = useRef(onQueryChange);
  onQueryChangeRef.current = onQueryChange;
  useEffect(() => {
    onQueryChangeRef.current?.(query);
  }, [query]);
  useEffect(() => () => onQueryChangeRef.current?.(undefined), []);

  // Adoption is memory of past props, so it is state adjusted during
  // render: an answer is taken only for the query being typed now, which
  // is what keeps a late answer to an older query out, and the last taken
  // answer stays while the next one is pending.
  const [adopted, setAdopted] = useState<AdoptedSuggestions | undefined>();
  const fresh =
    suggestions !== undefined &&
    query !== undefined &&
    query === suggestions.query;
  const adoptsFreshAnswer = fresh && adopted?.source !== suggestions;
  if (adoptsFreshAnswer) {
    setAdopted({
      query: suggestions.query,
      candidates: suggestions.candidates,
      source: suggestions,
    });
  }
  const adoptionOutlivedMention = mention === null && adopted !== undefined;
  if (adoptionOutlivedMention) {
    setAdopted(undefined);
  }

  const answered = adopted !== undefined && adopted.query === query;
  // The caller hears of a new query only after this render commits, so a
  // query no answer covers yet counts as pending; otherwise the list would
  // close for a frame on every keystroke.
  const pending =
    suggestions !== undefined && (suggestions.pending || !answered);
  const shown =
    suggestions === undefined
      ? filterByHandlePrefix(candidates, query ?? "")
      : (adopted?.candidates ?? []);
  const options = mention === null ? [] : shown.slice(0, MAX_MENTION_OPTIONS);
  const hasContent =
    suggestions === undefined
      ? options.length > 0
      : pending || (answered && options.length > 0);
  const open =
    mention !== null && hasContent && !blurred && dismissedAt !== mention.start;

  // Highlight resets when the query narrows the list under it.
  const clampedIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
  // An Escape dismissal lasts for the mention's continuous life: once no
  // mention is being typed, forget it, so the same position typed fresh
  // must reopen.
  useEffect(() => {
    if (mention === null && dismissedAt !== null) {
      setDismissedAt(null);
    }
  }, [mention, dismissedAt]);

  const listId = `${baseId}-mentions`;
  const optionId = (index: number) => `${listId}-${index}`;

  const select = (candidate: MentionCandidate) => {
    if (mention === null) {
      return;
    }
    const handle = readMentionHandle(candidate);
    const next = insertMention(value, mention.start, caret, handle);
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

  const hasActiveOption = open && options.length > 0;
  const activeOptionId = hasActiveOption ? optionId(clampedIndex) : undefined;
  const searching = open && pending;

  return {
    open,
    options,
    activeIndex: clampedIndex,
    listId,
    optionId,
    activeOptionId,
    searching,
    onCaretMove: (position) => {
      setBlurred(false);
      setCaret(position);
    },
    onBlur: () => setBlurred(true),
    onKeyDown: (event) => {
      if (!open) {
        return false;
      }
      // IME candidate-list keys are never popup commands.
      if (event.nativeEvent.isComposing) {
        return false;
      }
      // Modified Enter belongs to the editor (Cmd+Enter submits WHAT THE
      // USER SEES; Shift+Enter is the plain-newline escape hatch). The
      // popup must neither insert nor swallow it.
      if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey || event.shiftKey)
      ) {
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        // A list still searching has no row to move to; the caret keeps the key.
        if (options.length === 0) {
          return false;
        }
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(
          (clampedIndex + delta + options.length) % options.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const candidate = options[clampedIndex];
        if (candidate === undefined) {
          return false;
        }
        event.preventDefault();
        select(candidate);
        return true;
      }
      if (event.key === "Escape") {
        // Dismiss the popup only: the editor's own Escape semantics
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
