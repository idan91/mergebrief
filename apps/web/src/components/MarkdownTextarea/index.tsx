/* oxlint-disable jsx-a11y/no-autofocus --
   autoFocus is an opt-in prop: consumers that mount in response to an
   explicit user action (clicking a diff line opens the composer) pass it;
   nothing focuses on page load. */
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions --
   The root group's keydown is a composite-widget shortcut scope
   (Cmd+Shift+P / Escape from the textarea, tabs, and focused preview
   panel alike); the wrapper itself is not focusable and traps nothing. */
import type { TranslationKey } from "i18n";
import { Trans, useTranslation } from "react-i18next";
import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { ATTACHMENT_BRANCH, AttachmentMediaTypes } from "contract";

import { IconButton } from "../IconButton";
import { Markdown } from "../Markdown";
import { ScreenReaderOnly } from "../ScreenReaderOnly";
import { ToolbarIcons } from "./icons";
import { MentionList } from "./MentionList";
import { useMarkdownTextareaFacade } from "./useMarkdownTextareaFacade";
import {
  MarkdownTextareaModes,
  type MarkdownTextareaMode,
  type MentionCandidate,
  MentionListLayouts,
  type MentionListLayout,
  type MentionSuggestions,
} from "./types";
import { useFloatingMentionList } from "./useFloatingMentionList";
import { useMentionAutocomplete } from "./useMentionAutocomplete";
import { hasUploadPlaceholder } from "./utils";
import styles from "./MarkdownTextarea.module.scss";

export interface MarkdownTextareaProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the textarea; rendered as a real `<label>`. */
  label: string;
  /** Show the label visually (default: screen-reader only). */
  labelVisible?: boolean;
  /** Extra class for the visible label (call-site typography). */
  labelClassName?: string | undefined;
  placeholder?: string | undefined;
  autoFocus?: boolean;
  readOnly?: boolean;
  ariaBusy?: boolean;
  ariaInvalid?: boolean;
  /** id of the error/hint element associated with the textarea. */
  describedBy?: string | undefined;
  /** Blur hook for consumers that persist drafts on focus loss. */
  onBlur?: (() => void) | undefined;
  /**
   * Primary action for Cmd/Ctrl+Enter. The consumer's own submit guards
   * (empty body, pending, over-cap) apply, this only routes the shortcut.
   */
  onSubmit?: (() => void) | undefined;
  /** Escape hook (cancel an edit, blur a reply). */
  onEscape?: (() => void) | undefined;
  /** Enables the Insert-suggestion action, pre-filled with this text. */
  suggestionSeed?: string | undefined;
  /**
   * Candidate pool for `@`-mention autocomplete; empty/absent disables it.
   * The pool is injected, the component never fetches. Pool order IS the
   * ranking: the hook prefix-filters in array order and caps the list.
   * Unused when `mentionSuggestions` is present.
   */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  /**
   * The caller's answer to the query reported through
   * `onMentionQueryChange`, shown as given (capped, never filtered). Its
   * presence puts the list in the caller's hands; see `MentionSuggestions`
   * for what `query` and `pending` promise.
   */
  mentionSuggestions?: MentionSuggestions | undefined;
  /**
   * The text typed after `@` so far, once per change; undefined once the
   * caret leaves the mention, the surface is read-only, or on unmount.
   */
  onMentionQueryChange?: ((query: string | undefined) => void) | undefined;
  /**
   * How the open mention list sits: in the editor's flow (default), or
   * floating under the textarea for a host that centres on its height,
   * where a list changing rows would move the field being typed in.
   */
  mentionListLayout?: MentionListLayout;
  /** Preview-tab renderer; defaults to the shared Markdown component. */
  renderPreview?: ((value: string) => ReactNode) | undefined;
  /**
   * Hands the consumer the inner textarea element (quote-reply focuses it
   * after an external prefill). Ref-callback shape, called with null on
   * unmount.
   */
  exposeTextarea?: ((element: HTMLTextAreaElement | null) => void) | undefined;
  /**
   * The page live region with its toast: an image upload's failure lands
   * here. Success is visible in the preview, so it says nothing.
   */
  announce?: ((message: string) => void) | undefined;
  /** The live region alone: the upload's start, which the placeholder shows. */
  announceQuietly?: ((message: string) => void) | undefined;
  /** A failed upload's copy for the consumer's inline error surface. */
  onAttachError?: ((copy: string) => void) | undefined;
}

const ATTACH_ACCEPT = Object.values(AttachmentMediaTypes).join(",");
const EMPTY_CANDIDATES: readonly MentionCandidate[] = [];

const MODES: MarkdownTextareaMode[] = Object.values(MarkdownTextareaModes);
const MODE_LABEL_KEYS: Record<MarkdownTextareaMode, TranslationKey> = {
  [MarkdownTextareaModes.WRITE]: "shell.editorModeWrite",
  [MarkdownTextareaModes.PREVIEW]: "shell.editorModePreview",
};

interface PreviewPanelProps {
  readonly renderPreview: ((value: string) => ReactNode) | undefined;
  readonly value: string;
}

// Branches on the prop, not its return value: a custom preview that
// legitimately renders null must not fall back to the default renderer.
function PreviewPanel({ renderPreview, value }: PreviewPanelProps) {
  const { t } = useTranslation();

  if (renderPreview !== undefined) {
    return renderPreview(value);
  }
  if (value.trim()) {
    return (
      <Markdown content={value} renderHtml renderMentions renderSuggestions />
    );
  }
  return <p className={styles["empty"]}>{t("shell.nothingToPreview")}</p>;
}

/**
 * The one markdown composing surface: Write/Preview tabs, a formatting
 * toolbar, and keyboard shortcuts around a plain controlled textarea.
 * Consumers own the value, submission, error copy, and surrounding chrome;
 * this component owns editing affordances only.
 */
export function MarkdownTextarea({
  value,
  onChange,
  label,
  labelVisible = false,
  labelClassName,
  placeholder,
  autoFocus = false,
  readOnly = false,
  ariaBusy = false,
  ariaInvalid = false,
  describedBy,
  onBlur,
  onSubmit,
  onEscape,
  suggestionSeed,
  mentionCandidates,
  mentionSuggestions,
  onMentionQueryChange,
  mentionListLayout = MentionListLayouts.IN_FLOW,
  renderPreview,
  exposeTextarea,
  announce,
  announceQuietly,
  onAttachError,
}: MarkdownTextareaProps) {
  const { t } = useTranslation();
  const facade = useMarkdownTextareaFacade({
    value,
    onChange,
    readOnly,
    suggestionSeed,
    announce,
    announceQuietly,
    onAttachError,
  });
  const baseId = useId();
  const mentions = useMentionAutocomplete({
    value,
    onChange,
    candidates: mentionCandidates ?? EMPTY_CANDIDATES,
    suggestions: mentionSuggestions,
    onQueryChange: onMentionQueryChange,
    readOnly,
    textareaRef: facade.textareaRef,
    baseId,
  });
  const floatingList = useFloatingMentionList(
    mentionListLayout === MentionListLayouts.FLOATING,
  );
  const { textareaRef } = facade;
  const { setAnchor } = floatingList;
  // A new ref callback re-attaches every commit, and the floating anchor's
  // setter writes state, so its identity follows only what it hands the node to.
  const attachTextarea = useCallback(
    (element: HTMLTextAreaElement | null) => {
      textareaRef.current = element;
      setAnchor(element);
      exposeTextarea?.(element);
    },
    [exposeTextarea, setAnchor, textareaRef],
  );
  // Rows already on screen speak for themselves; repeating the search per
  // keystroke over them is noise.
  const announceSearching = mentions.searching && mentions.options.length === 0;
  const textareaId = `${baseId}-input`;
  const tabId = (mode: MarkdownTextareaMode) => `${baseId}-tab-${mode}`;
  const panelId = (mode: MarkdownTextareaMode) => `${baseId}-panel-${mode}`;

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.indexOf(facade.mode);
    let next = index;
    if (event.key === "ArrowRight") {
      next = (index + 1) % MODES.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + MODES.length) % MODES.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = MODES.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const mode = MODES[next];
    if (!mode) {
      return;
    }
    facade.setMode(mode);
    document.getElementById(tabId(mode))?.focus();
  };

  // Roving tabindex across the toolbar: one tab stop for the group, arrows
  // move within it, and Tab re-enters at the last-focused control (toolbar
  // pattern), so the focused index is state, not just DOM focus.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarIndex, setToolbarIndex] = useState(0);
  const toolbarTabStop = Math.min(
    toolbarIndex,
    facade.toolbarActions.length - 1,
  );
  const toolbarButtons = facade.toolbarActions.map((action) => ({
    action,
    description: action.title === action.label ? undefined : action.title,
  }));
  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = toolbarRef.current
      ? [...toolbarRef.current.querySelectorAll("button")]
      : [];
    if (buttons.length === 0) {
      return;
    }
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    const index = current === -1 ? toolbarTabStop : current;
    let next = index;
    if (event.key === "ArrowRight") {
      next = (index + 1) % buttons.length;
    } else if (event.key === "ArrowLeft") {
      next = (index - 1 + buttons.length) % buttons.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = buttons.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    setToolbarIndex(next);
    buttons[next]?.focus();
  };

  const labelElement = (
    <label className={labelClassName} htmlFor={textareaId}>
      {label}
    </label>
  );

  // Root-level shortcut scope, these must work from the textarea, the tabs,
  // AND the focused preview panel; a textarea-only handler would die the
  // moment the write panel hides.
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // IME commit/cancel keys are never editor commands.
    if (event.nativeEvent.isComposing) {
      return;
    }
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key === "Enter" && onSubmit !== undefined) {
      // The consumer's own submit guards (empty, pending, over-cap) apply;
      // a placeholder still in the text is the one guard held here for
      // every one, since a body sent now would carry it, not the image.
      event.preventDefault();
      if (facade.uploadsInFlight > 0 || hasUploadPlaceholder(value)) {
        const copy = t("shell.attach.waitForUpload");
        onAttachError?.(copy);
        announce?.(copy);
        return;
      }
      onSubmit();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      const next =
        facade.mode === MarkdownTextareaModes.WRITE
          ? MarkdownTextareaModes.PREVIEW
          : MarkdownTextareaModes.WRITE;
      facade.setMode(next);
      // Hiding the panel that holds focus drops it to <body>, which would
      // kill this very handler, move focus WITH the mode, both ways.
      window.setTimeout(() => {
        if (next === MarkdownTextareaModes.WRITE) {
          facade.textareaRef.current?.focus();
        } else {
          document
            .getElementById(panelId(MarkdownTextareaModes.PREVIEW))
            ?.focus();
        }
      }, 0);
      return;
    }
    if (event.key === "Escape" && onEscape !== undefined) {
      // Consumed here: without stopPropagation an Escape meant to cancel
      // this editor would also reach window-level listeners (e.g. an open
      // CommentComposer's close handler) and dismiss surfaces beyond it.
      event.stopPropagation();
      onEscape();
    }
  };

  return (
    <div
      // Group role names the editor region for SR users; the keydown is a
      // composite-widget shortcut scope, not a keyboard-only interaction.
      aria-label={t("shell.ariaLabelMarkdownEditor")}
      className={styles["markdownTextarea"]}
      data-testid="markdown-textarea"
      role="group"
      onKeyDown={onRootKeyDown}
    >
      {labelVisible ? (
        labelElement
      ) : (
        <ScreenReaderOnly>{labelElement}</ScreenReaderOnly>
      )}
      <div className={styles["field"]}>
        <div className={styles["head"]}>
          <div
            // Deliberately NOT derived from `label`: a substring match on the
            // textarea's label must find exactly one element (label queries).
            aria-label={t("shell.ariaLabelEditorMode")}
            className={styles["tabs"]}
            role="tablist"
            tabIndex={-1}
            onKeyDown={onTablistKeyDown}
          >
            {MODES.map((mode) => {
              const modeLabel = t(MODE_LABEL_KEYS[mode]);
              return (
                // oxlint-disable-next-line house/no-raw-button -- role=tab under the tablist's roving tabindex: singleton role plumbing no sibling models
                <button
                  aria-controls={panelId(mode)}
                  aria-selected={facade.mode === mode}
                  data-state={facade.mode === mode ? "active" : undefined}
                  id={tabId(mode)}
                  key={mode}
                  role="tab"
                  tabIndex={facade.mode === mode ? 0 : -1}
                  type="button"
                  onClick={() => facade.setMode(mode)}
                >
                  {modeLabel}
                </button>
              );
            })}
          </div>
          <div
            aria-label={t("shell.ariaLabelFormatting")}
            className={styles["toolbar"]}
            hidden={facade.mode !== MarkdownTextareaModes.WRITE}
            ref={toolbarRef}
            role="toolbar"
            tabIndex={-1}
            onKeyDown={onToolbarKeyDown}
          >
            {toolbarButtons.map(({ action, description }, index) => (
              <IconButton
                aria-disabled={readOnly || action.disabled || undefined}
                aria-description={description}
                aria-label={action.label}
                callout="top"
                key={action.icon}
                label={action.title}
                tabIndex={index === toolbarTabStop ? 0 : -1}
                onClick={action.run}
              >
                {ToolbarIcons[action.icon]}
              </IconButton>
            ))}
          </div>
        </div>
        <div
          aria-labelledby={tabId(MarkdownTextareaModes.WRITE)}
          hidden={facade.mode !== MarkdownTextareaModes.WRITE}
          id={panelId(MarkdownTextareaModes.WRITE)}
          role="tabpanel"
        >
          {/* Reached through the toolbar button; never a tab stop of its own. */}
          <input
            accept={ATTACH_ACCEPT}
            aria-hidden
            className={styles["fileInput"]}
            multiple
            ref={facade.fileInputRef}
            tabIndex={-1}
            type="file"
            onChange={(event) => {
              const files = event.target.files;
              if (files !== null) {
                facade.attachFiles(files);
              }
              event.target.value = "";
            }}
          />
          <textarea
            aria-activedescendant={mentions.activeOptionId}
            aria-busy={ariaBusy || facade.uploadsInFlight > 0 || undefined}
            aria-controls={mentions.open ? mentions.listId : undefined}
            aria-describedby={describedBy}
            aria-invalid={ariaInvalid || undefined}
            autoFocus={autoFocus}
            className={styles["textarea"]}
            // RTL-first content right-aligns (browser-resolved from the text).
            dir="auto"
            id={textareaId}
            placeholder={placeholder}
            readOnly={readOnly}
            ref={attachTextarea}
            suppressHydrationWarning
            value={value}
            onBlur={() => {
              mentions.onBlur();
              onBlur?.();
            }}
            onChange={(event) => {
              mentions.onCaretMove(event.target.selectionStart);
              onChange(event.target.value);
            }}
            onKeyDown={(event) => {
              // The open popup owns navigation/accept/dismiss keys; every
              // other key falls through to the editing shortcuts.
              if (mentions.onKeyDown(event)) {
                return;
              }
              facade.onTextareaKeyDown(event);
            }}
            onDragOver={facade.onTextareaDragOver}
            onDrop={facade.onTextareaDrop}
            onPaste={facade.onTextareaPaste}
            onSelect={(event) =>
              mentions.onCaretMove(event.currentTarget.selectionStart)
            }
          />
          {mentions.open ? (
            <MentionList
              activeIndex={mentions.activeIndex}
              layout={mentionListLayout}
              listId={mentions.listId}
              optionId={mentions.optionId}
              options={mentions.options}
              pending={mentions.searching}
              positionRef={floatingList.setList}
              positionStyle={floatingList.listStyle}
              onSelect={mentions.select}
            />
          ) : null}
          <ScreenReaderOnly>
            {/* Always mounted so the search is announced; emptied when it lands so the next one announces again. */}
            <span aria-live="polite" role="status">
              {announceSearching ? t("shell.mentionSearchingAnnounce") : ""}
            </span>
          </ScreenReaderOnly>
          {facade.canAttach ? (
            <p className={styles["hint"]}>
              <Trans
                components={[<code key="branch">{ATTACHMENT_BRANCH}</code>]}
                i18nKey="shell.attach.hint"
              />
            </p>
          ) : null}
        </div>
        <div
          aria-labelledby={tabId(MarkdownTextareaModes.PREVIEW)}
          className={styles["previewPanel"]}
          hidden={facade.mode !== MarkdownTextareaModes.PREVIEW}
          id={panelId(MarkdownTextareaModes.PREVIEW)}
          role="tabpanel"
          // Rendered markdown usually has no focusables, make the panel
          // itself the tab stop so keyboard users can reach and scroll it
          // (APG tabs pattern recommendation for content-only panels).
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
        >
          {facade.mode === MarkdownTextareaModes.PREVIEW ? (
            <PreviewPanel renderPreview={renderPreview} value={value} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
