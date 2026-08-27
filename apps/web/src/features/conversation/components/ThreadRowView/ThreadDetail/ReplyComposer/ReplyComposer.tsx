import type { TranslationKey } from "i18n";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@web/components/Button/Button";
import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import type { MentionCandidate } from "@web/components/MarkdownTextarea/useMentionAutocomplete";
import { appendQuote } from "../../../../utils/quote";
import { useReviewActions } from "@web/features/review/session";
import { MAX_REPLY_LENGTH, type ReplyResult } from "../../../../reply";
import type { ResolveAttempt } from "../useThreadResolution";
import { readReplyDraft, writeReplyDraft } from "./utils";
import rowStyles from "../../../../rows.module.scss";
import styles from "./ReplyComposer.module.scss";

const REPLY_KEYS = {
  posted: "conversation.replyResult.posted",
  unauthorized: "conversation.replyResult.unauthorized",
  "not-found": "conversation.replyResult.notFound",
  invalid: "conversation.replyResult.invalid",
  "no-write-access": "pulls.briefError.no-repo-write-access",
  upstream: "conversation.replyResult.upstream",
  // INDETERMINATE: a throw can land after the POST reached GitHub — never
  // claim "nothing was posted".
  failed: "conversation.replyResult.failed",
} as const satisfies Record<string, TranslationKey>;

/** Failure key per non-posted result kind — every kind keeps the draft. */
const REPLY_FAILURE_KEYS: Record<
  Exclude<ReplyResult["kind"], "posted">,
  TranslationKey
> = {
  unauthorized: REPLY_KEYS.unauthorized,
  "not-found": REPLY_KEYS["not-found"],
  invalid: REPLY_KEYS.invalid,
  "no-write-access": REPLY_KEYS["no-write-access"],
  upstream: REPLY_KEYS.upstream,
};

/**
 * Reply & resolve outcomes. The legs are sequenced FE-side, so each end names
 * exactly what did and did not happen — never a shared "failed": whether the
 * reply landed decides whether retrying is safe.
 */
const COMBO_KEYS = {
  both: "conversation.replyResult.both",
  /** The reply LANDED and the resolve did not — send them to Resolve. */
  partial: "conversation.replyResult.partial",
  /** The reply landed and the resolve THREW — never assert a failure. */
  partialIndeterminate: "conversation.replyResult.partialIndeterminate",
  /** Appended to the reply's own failure copy: the resolve leg never ran. */
  replyFailedSuffix: "conversation.replyResult.replyFailedSuffix",
} as const satisfies Record<string, TranslationKey>;

export interface ReplyComposerProps {
  /** Writes are off: the box takes no text and the actions refuse. */
  readOnlyReason?: string | undefined;
  threadId: number;
  post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  onPosted: () => void;
  /** Mention-autocomplete pool: participants plus collaborators. */
  mentionCandidates?: readonly MentionCandidate[] | undefined;
  /**
   * Quote-reply prefill: a new nonce appends the (already `> `-prefixed)
   * block to the draft and focuses the box. Nonce, not text, is the
   * trigger — quoting the same comment twice must append twice.
   */
  quote?: { block: string; nonce: number } | undefined;
  /**
   * Resolves the thread AFTER the reply lands, reporting the attempt's
   * outcome. Absent = no capability or an already-resolved thread, and the
   * secondary action never renders. The primary action stays a plain reply.
   */
  resolveAfterPost?: (() => Promise<ResolveAttempt>) | undefined;
  /**
   * Moves focus to the thread's standalone resolve control. Called when the
   * combo button RETIRES while holding focus (the reply cleared the draft), so
   * the keyboard lands on the retry path instead of on `<body>`.
   */
  focusResolveAction?: (() => void) | undefined;
}

export function ReplyComposer({
  readOnlyReason,
  threadId,
  post,
  onPosted,
  mentionCandidates,
  quote,
  resolveAfterPost,
  focusResolveAction,
}: ReplyComposerProps) {
  const { t } = useTranslation();
  const { announce } = useReviewActions();
  // WHICH action is running, not just whether one is: both buttons go busy
  // together (one draft, one request), but only the clicked one wears the
  // pending label — a "Posting…" on the plain Reply button would misreport a
  // running combo.
  const [pendingAction, setPendingAction] = useState<
    "reply" | "reply-and-resolve" | null
  >(null);
  const pending = pendingAction !== null;
  const [error, setError] = useState<string | null>(null);
  // Synchronous double-click guard: state updates are async, a ref is not —
  // aria-disabled does not block the click event.
  const inFlight = useRef(false);
  // The box and its durable copy move together: sessionStorage is the only
  // place unsent reply text lives, so an edit writes straight through.
  const [local, setLocal] = useState(() => readReplyDraft(threadId));
  const localRef = useRef(local);
  localRef.current = local;
  const edit = useCallback(
    (body: string) => {
      setLocal(body);
      localRef.current = body;
      writeReplyDraft(threadId, body);
    },
    [threadId],
  );
  // Instance-scoped id: the same thread can render TWO composers (inline at
  // its chunk AND in the section) — a thread-derived id would duplicate and
  // break label/error association.
  const inputId = `${useId()}-reply`;
  const overCap = local.length > MAX_REPLY_LENGTH;
  const blocked =
    pending || local.trim() === "" || overCap || readOnlyReason !== undefined;

  // Quote-reply prefill appends to the LOCAL draft only, same persistence
  // path as typing. Skipped while a post is in flight: the composer is
  // read-only and a mutation would diverge from the captured request body.
  const textareaElement = useRef<HTMLTextAreaElement | null>(null);
  const consumedQuoteNonce = useRef(0);
  useEffect(() => {
    if (quote === undefined || quote.nonce === consumedQuoteNonce.current) {
      return;
    }
    consumedQuoteNonce.current = quote.nonce;
    if (inFlight.current) return;
    edit(appendQuote(localRef.current, quote.block));
    window.setTimeout(() => {
      const element = textareaElement.current;
      if (element === null) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }, 0);
  }, [edit, quote]);

  // The combo button's node (focus-handoff subject) and the flag saying its
  // retirement stranded focus. The effect runs AFTER the unmount commits, so
  // the handoff target is reachable and nothing re-steals focus behind it.
  const comboButtonRef = useRef<HTMLButtonElement | null>(null);
  const handoffFocusRef = useRef(false);
  useEffect(() => {
    if (pendingAction !== null || !handoffFocusRef.current) return;
    handoffFocusRef.current = false;
    // Only hand over focus we actually stranded: anything the settle already
    // moved focus to (a rescue elsewhere, the reviewer clicking on) keeps it.
    if (
      document.activeElement !== null &&
      document.activeElement !== document.body
    ) {
      return;
    }
    focusResolveAction?.();
  }, [focusResolveAction, pendingAction]);

  const submit = (alsoResolve: boolean) => {
    if (blocked || inFlight.current) return;
    // The combo is only reachable while the leg exists; guard anyway so a
    // stale closure can never take the compound path without it.
    const resolveLeg = alsoResolve ? resolveAfterPost : undefined;
    inFlight.current = true;
    setPendingAction(resolveLeg === undefined ? "reply" : "reply-and-resolve");
    setError(null);
    // Captured at click time — edits mid-flight never count as sent.
    const body = local;
    const fail = (copy: string) => {
      setError(copy);
      announce(copy);
    };
    // The reply never landed, so the resolve leg was never reached — say both
    // halves, or the reviewer guesses whether the thread closed anyway.
    const replyFailureCopy = (copy: string) =>
      resolveLeg === undefined
        ? copy
        : `${copy} ${t(COMBO_KEYS.replyFailedSuffix)}`;
    void (async () => {
      try {
        let result: ReplyResult;
        try {
          result = await post(threadId, body);
        } catch {
          fail(replyFailureCopy(t(REPLY_KEYS.failed)));
          return;
        }
        if (result.kind !== "posted") {
          fail(replyFailureCopy(t(REPLY_FAILURE_KEYS[result.kind])));
          return;
        }
        // The external write is the commit point: clear the draft (the
        // reply is GitHub's record now) and let the caller refetch.
        edit("");
        if (resolveLeg === undefined) {
          announce(t(REPLY_KEYS.posted));
          onPosted();
          return;
        }
        // Sequenced, never parallel: the reply is the commit point and the
        // resolve only makes sense once it landed. The reply leg is NEVER
        // retried from here — a landed reply retried is a double post.
        const outcome = await resolveLeg();
        if (outcome === "resolved") {
          announce(t(COMBO_KEYS.both));
        } else {
          // Partial: the copy stays next to the Resolve button that finishes
          // the job, and distinguishes a known failure from an unproven one.
          fail(
            outcome === "indeterminate"
              ? t(COMBO_KEYS.partialIndeterminate)
              : t(COMBO_KEYS.partial),
          );
        }
        // The reply landed either way, so the conversation is stale either
        // way. A same-key invalidation while the resolve leg's own refetch is
        // in flight is deduped by react-query.
        onPosted();
      } finally {
        inFlight.current = false;
        // Focus handoff, decided BEFORE the state update that unmounts the
        // button: an unmount under the caret drops focus to <body>. Recorded
        // here, performed in the effect above — focusing now would land on a
        // node React is about to remove.
        handoffFocusRef.current =
          comboButtonRef.current !== null &&
          document.activeElement === comboButtonRef.current &&
          localRef.current.trim() === "";
        setPendingAction(null);
      }
    })();
  };

  return (
    <div className={styles["composer"]}>
      <MarkdownTextarea
        ariaBusy={pending}
        ariaInvalid={overCap}
        describedBy={overCap || error !== null ? `${inputId}-error` : undefined}
        label={t("conversation.replyLabel")}
        labelClassName={styles["composerLabel"]}
        exposeTextarea={(element) => {
          textareaElement.current = element;
        }}
        labelVisible
        mentionCandidates={mentionCandidates}
        readOnly={pending || readOnlyReason !== undefined}
        value={local}
        onChange={edit}
        // Escape blurs the reply (the blur persists the draft); the text
        // itself is never cleared — the draft is the recovery path.
        onEscape={() => {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
        }}
        // The keyboard shortcut is the PRIMARY action only — a compound
        // outward write is never implicit.
        onSubmit={() => submit(false)}
      />
      {readOnlyReason !== undefined ? (
        <p className={rowStyles["error"]}>{readOnlyReason}</p>
      ) : null}
      {overCap || error !== null ? (
        <p className={rowStyles["error"]} id={`${inputId}-error`} role="alert">
          {overCap
            ? t("conversation.replyTooLong", { max: MAX_REPLY_LENGTH })
            : error}
        </p>
      ) : null}
      <div className={rowStyles["detailActions"]}>
        {/* Focusable-disabled: a hard `disabled` would drop keyboard/SR focus
            to <body> the moment posting starts, and strand it there on
            success. The click guard lives in submit(). */}
        <Button
          aria-busy={pendingAction === "reply" || undefined}
          aria-disabled={blocked || undefined}
          variant="quiet"
          onClick={() => submit(false)}
        >
          {pendingAction === "reply"
            ? t("conversation.posting")
            : t("conversation.reply")}
        </Button>
        {/* Only with text in the box: closing a thread you have nothing to say
            on is the standalone Resolve button's job. It stays mounted for its
            own run — a busy control that vanishes mid-request drops both the
            aria-busy state and the focus sitting on it. */}
        {resolveAfterPost !== undefined &&
        (local.trim() !== "" || pendingAction === "reply-and-resolve") ? (
          <Button
            aria-busy={pendingAction === "reply-and-resolve" || undefined}
            aria-disabled={blocked || undefined}
            data-testid="reply-and-resolve"
            ref={comboButtonRef}
            variant="quiet"
            onClick={() => submit(true)}
          >
            {pendingAction === "reply-and-resolve"
              ? t("conversation.postingAndResolving")
              : t("conversation.replyAndResolve")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
