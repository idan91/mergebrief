/* eslint-disable jsx-a11y/no-autofocus --
   autoFocus is an opt-in prop: consumers that mount in response to an
   explicit user action (clicking a diff line opens the composer) pass it;
   nothing focuses on page load. */
/* eslint-disable jsx-a11y/no-noninteractive-element-interactions --
   The root group's keydown is a composite-widget shortcut scope
   (Cmd+Shift+P / Escape from the textarea, tabs, and focused preview
   panel alike); the wrapper itself is not focusable and traps nothing. */
import { useTranslation } from "react-i18next";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { IconButton } from "../IconButton/IconButton";
import { Markdown } from "../Markdown/Markdown";
import { ScreenReaderOnly } from "../ScreenReaderOnly/ScreenReaderOnly";
import { TOOLBAR_ICONS } from "./icons";
import {
  useMarkdownTextareaFacade,
  type MarkdownTextareaMode,
} from "./useMarkdownTextareaFacade";
import {
  useMentionAutocomplete,
  type MentionCandidate,
} from "./useMentionAutocomplete";
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
   * (empty body, pending, over-cap) apply — this only routes the shortcut.
   */
  onSubmit?: (() => void) | undefined;
  /** Escape hook (cancel an edit, blur a reply). */
  onEscape?: (() => void) | undefined;
  /** Enables the Insert-suggestion action, pre-filled with this text. */
  suggestionSeed?: string | undefined;
  /**
   * Candidate pool for `@`-mention autocomplete; empty/absent disables it.
   * The pool is injected (thread participants, repo collaborators) — the
   * component never fetches. Pool order IS the ranking: the hook
   * prefix-filters in array order and caps the list.
   */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  /** Preview-tab renderer; defaults to the shared Markdown component. */
  renderPreview?: ((value: string) => ReactNode) | undefined;
  /**
   * Hands the consumer the inner textarea element (quote-reply focuses it
   * after an external prefill). Ref-callback shape — called with null on
   * unmount.
   */
  exposeTextarea?: ((element: HTMLTextAreaElement | null) => void) | undefined;
}

const MODES: MarkdownTextareaMode[] = ["write", "preview"];
const MODE_LABELS: Record<MarkdownTextareaMode, string> = {
  write: "Write",
  preview: "Preview",
};

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
  renderPreview,
  exposeTextarea,
}: MarkdownTextareaProps) {
  const { t } = useTranslation();
  const facade = useMarkdownTextareaFacade({
    value,
    onChange,
    readOnly,
    suggestionSeed,
  });
  const baseId = useId();
  const mentions = useMentionAutocomplete({
    value,
    onChange,
    candidates: mentionCandidates ?? [],
    readOnly,
    textareaRef: facade.textareaRef,
    baseId,
  });
  const textareaId = `${baseId}-input`;
  const tabId = (mode: MarkdownTextareaMode) => `${baseId}-tab-${mode}`;
  const panelId = (mode: MarkdownTextareaMode) => `${baseId}-panel-${mode}`;

  const onTablistKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = MODES.indexOf(facade.mode);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % MODES.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + MODES.length) % MODES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = MODES.length - 1;
    else return;
    event.preventDefault();
    const mode = MODES[next];
    if (!mode) return;
    facade.setMode(mode);
    document.getElementById(tabId(mode))?.focus();
  };

  // Roving tabindex across the toolbar: one tab stop for the group, arrows
  // move within it, and Tab re-enters at the last-focused control (toolbar
  // pattern) — so the focused index is state, not just DOM focus.
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolbarIndex, setToolbarIndex] = useState(0);
  const toolbarTabStop = Math.min(
    toolbarIndex,
    facade.toolbarActions.length - 1,
  );
  const onToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = toolbarRef.current
      ? [...toolbarRef.current.querySelectorAll("button")]
      : [];
    if (buttons.length === 0) return;
    const current = buttons.findIndex(
      (button) => button === document.activeElement,
    );
    const index = current === -1 ? toolbarTabStop : current;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    setToolbarIndex(next);
    buttons[next]?.focus();
  };

  const labelElement = (
    <label className={labelClassName} htmlFor={textareaId}>
      {label}
    </label>
  );

  // Branch on the prop, not its return value: a custom preview that
  // legitimately renders null must not fall back to the default renderer.
  const renderPreviewPanel = () =>
    renderPreview !== undefined ? (
      renderPreview(value)
    ) : value.trim() ? (
      <Markdown content={value} renderSuggestions />
    ) : (
      <p className={styles["empty"]}>{t("shell.nothingToPreview")}</p>
    );

  // Root-level shortcut scope — these must work from the textarea, the tabs,
  // AND the focused preview panel; a textarea-only handler would die the
  // moment the write panel hides.
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // IME commit/cancel keys are never editor commands.
    if (event.nativeEvent.isComposing) return;
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key === "Enter" && onSubmit !== undefined) {
      // The consumer's own submit guards (empty, pending, over-cap) apply.
      event.preventDefault();
      onSubmit();
      return;
    }
    if (meta && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      const next = facade.mode === "write" ? "preview" : "write";
      facade.setMode(next);
      // Hiding the panel that holds focus drops it to <body>, which would
      // kill this very handler — move focus WITH the mode, both ways.
      window.setTimeout(() => {
        if (next === "write") facade.textareaRef.current?.focus();
        else document.getElementById(panelId("preview"))?.focus();
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
      <div
        // Deliberately NOT derived from `label`: a substring match on the
        // textarea's label must find exactly one element (label queries).
        aria-label={t("shell.ariaLabelEditorMode")}
        className={styles["tabs"]}
        role="tablist"
        tabIndex={-1}
        onKeyDown={onTablistKeyDown}
      >
        {MODES.map((mode) => (
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
            {MODE_LABELS[mode]}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={tabId("write")}
        hidden={facade.mode !== "write"}
        id={panelId("write")}
        role="tabpanel"
      >
        <div
          aria-label={t("shell.ariaLabelFormatting")}
          className={styles["toolbar"]}
          ref={toolbarRef}
          role="toolbar"
          tabIndex={-1}
          onKeyDown={onToolbarKeyDown}
        >
          {facade.toolbarActions.map((action, index) => (
            <IconButton
              aria-disabled={readOnly || undefined}
              key={action.icon}
              label={action.label}
              tabIndex={index === toolbarTabStop ? 0 : -1}
              title={action.title}
              onClick={action.run}
            >
              {TOOLBAR_ICONS[action.icon]}
            </IconButton>
          ))}
        </div>
        <textarea
          aria-activedescendant={mentions.activeOptionId}
          aria-busy={ariaBusy || undefined}
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
          ref={(element) => {
            facade.textareaRef.current = element;
            exposeTextarea?.(element);
          }}
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
            if (mentions.onKeyDown(event)) return;
            facade.onTextareaKeyDown(event);
          }}
          onSelect={(event) =>
            mentions.onCaretMove(event.currentTarget.selectionStart)
          }
        />
        {mentions.open ? (
          <div
            aria-label={t("shell.ariaLabelMentionSuggestions")}
            className={styles["mentionPopup"]}
            id={mentions.listId}
            role="listbox"
          >
            {mentions.options.map((candidate, index) => (
              <div
                aria-selected={index === mentions.activeIndex}
                className={styles["mentionOption"]}
                data-state={
                  index === mentions.activeIndex ? "active" : undefined
                }
                id={mentions.optionId(index)}
                key={candidate.login}
                role="option"
                // Focus stays in the textarea (aria-activedescendant
                // pattern); -1 satisfies focusability without a tab stop.
                tabIndex={-1}
                // mousedown, not click: click fires after the textarea's
                // blur, and blur-persist consumers would race the insert.
                onMouseDown={(event) => {
                  event.preventDefault();
                  mentions.select(candidate.login);
                }}
              >
                {candidate.avatarUrl === undefined ? (
                  <span aria-hidden className={styles["mentionAvatarSlot"]} />
                ) : (
                  // Decorative — the option text carries the identity.
                  <img
                    alt=""
                    className={styles["mentionAvatar"]}
                    src={candidate.avatarUrl}
                  />
                )}
                <span className={styles["mentionLogin"]}>
                  @{candidate.login}
                </span>
                {candidate.name === undefined ? null : (
                  <span className={styles["mentionName"]}>
                    {candidate.name}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div className={styles["hint"]}>{t("shell.markdownSupported")}</div>
      </div>
      <div
        aria-labelledby={tabId("preview")}
        className={styles["previewPanel"]}
        hidden={facade.mode !== "preview"}
        id={panelId("preview")}
        role="tabpanel"
        // Rendered markdown usually has no focusables — make the panel
        // itself the tab stop so keyboard users can reach and scroll it
        // (APG tabs pattern recommendation for content-only panels).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
      >
        {facade.mode === "preview" ? renderPreviewPanel() : null}
      </div>
    </div>
  );
}
