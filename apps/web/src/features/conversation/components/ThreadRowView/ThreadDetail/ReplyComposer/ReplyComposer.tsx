import { useEffect, useId, useRef, useState } from "react";

import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import { appendQuote } from "../../../../utils/quote";
import {
  persistReplyDraft,
  useMindMap,
  useMindMapActions,
  useReviewActions,
} from "@web/features/review/session";
import { MAX_REPLY_LENGTH, type ReplyResult } from "../../../../reply";
import type { ResolveAttempt } from "../useThreadResolution";
import rowStyles from "../../../../rows.module.scss";
import styles from "./ReplyComposer.module.scss";

const REPLY_COPY = {
  posted: "Reply posted to GitHub under your account.",
  unauthorized:
    "Your GitHub session expired — sign in again. Your reply draft is saved locally.",
  "not-found":
    "This thread is no longer on GitHub — it may have been deleted. Your draft is saved locally.",
  invalid: "The reply was rejected as invalid — reload and try again.",
  upstream: "GitHub rejected the reply or is unreachable — try again shortly.",
  // INDETERMINATE (same discipline as submit): a throw can land after the
  // POST reached GitHub — never claim "nothing was posted".
  failed:
    "Something went wrong posting the reply — it may or may not have posted. Check the thread on GitHub before retrying.",
} as const;

/** Failure copy per non-posted result kind — every kind keeps the draft. */
const REPLY_FAILURE_COPY: Record<
  Exclude<ReplyResult["kind"], "posted">,
  string
> = {
  unauthorized: REPLY_COPY.unauthorized,
  "not-found": REPLY_COPY["not-found"],
  invalid: REPLY_COPY.invalid,
  upstream: REPLY_COPY.upstream,
};

/**
 * Reply & resolve outcomes (BRIEF-93). The two legs are sequenced FE-side
 * (reply, then resolve), so the compound action has three honest ends and each
 * one names exactly what did and did not happen. Never a shared "failed":
 * whether the reply landed decides whether retrying is safe.
 */
const COMBO_COPY = {
  both: "Reply posted and the thread resolved.",
  /**
   * The reply LANDED and the resolve did not. The reply is GitHub's record now
   * — the copy must send the reviewer to the standalone Resolve button, never
   * back through this composer (that would double-post).
   */
  partial:
    "Your reply posted, but resolving the thread failed. The reply is on GitHub — use Resolve on the thread to finish.",
  /**
   * The reply landed and the resolve THREW — it may have reached GitHub before
   * the connection died. Same discipline as every other throw around a write:
   * never assert a failure that may not have happened, and never invite a blind
   * retry of a possibly-applied change.
   */
  partialIndeterminate:
    "Your reply posted; the thread may or may not have been resolved. The conversation was refreshed — check the thread before resolving it again.",
  /** Appended to the reply's own failure copy: the resolve leg never ran. */
  replyFailedSuffix: "The thread was left unresolved.",
} as const;

export interface ReplyComposerProps {
  briefId: string;
  threadId: number;
  post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  onPosted: () => void;
  /** Mention-autocomplete pool (thread participants — BRIEF-56). */
  mentionCandidates?: readonly string[] | undefined;
  /**
   * Quote-reply prefill: a new nonce appends the (already `> `-prefixed)
   * block to the draft and focuses the box. Nonce, not text, is the
   * trigger — quoting the same comment twice must append twice.
   */
  quote?: { block: string; nonce: number } | undefined;
  /**
   * The Reply & resolve leg (BRIEF-93): resolves the thread AFTER the reply
   * lands, reporting the attempt's outcome. Absent = no capability or an
   * already-resolved thread, and the secondary action never renders. The
   * primary action stays a plain reply either way.
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
  briefId,
  threadId,
  post,
  onPosted,
  mentionCandidates,
  quote,
  resolveAfterPost,
  focusResolveAction,
}: ReplyComposerProps) {
  // Draft reads/writes go straight to the session stores (the PR 3 wiring
  // re-shape): no draft prop chain through the digest tree.
  const draft = useMindMap(
    (state) => state.replyDrafts[String(threadId)] ?? "",
  );
  const { setReplyDraft } = useMindMapActions();
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
  // Synchronous double-click guard (same as useReviewSubmit): state updates
  // are async, a ref is not — aria-disabled does not block the click event.
  const inFlight = useRef(false);
  // Typing stays LOCAL: a per-keystroke store write would re-render the
  // whole digest and rebuild the receipt memo chain. The store draft syncs
  // on blur, unmount, and post — the persistence points that matter for
  // surviving navigation.
  const [local, setLocal] = useState(draft);
  const localRef = useRef(local);
  localRef.current = local;
  // Only a composer the user actually EDITED may sync outward: with the
  // same thread rendered inline and in the section, an untouched twin's
  // unmount/blur must never clobber the draft the edited one saved.
  const dirtyRef = useRef(false);
  // Mirrors the STORE's current value (not "what this composer last wrote"):
  // comparing against it means an external reset (Clear local drafts) can't
  // silently un-persist text the user still SEES — behavior follows visible
  // state.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const setDraftRef = useRef(setReplyDraft);
  setDraftRef.current = setReplyDraft;
  useEffect(() => {
    return () => {
      if (dirtyRef.current && localRef.current !== draftRef.current) {
        setDraftRef.current(threadId, localRef.current);
        // The live-store write can race the provider's debounced
        // sessionStorage flush on full navigation — write durably too,
        // best-effort like every direct snapshot write.
        try {
          persistReplyDraft(briefId, threadId, localRef.current);
        } catch (persistError) {
          console.error("reply draft: durable write failed", persistError);
        }
      }
    };
    // Mount/unmount only — the refs carry current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const persist = () => {
    if (dirtyRef.current && local !== draftRef.current) {
      draftRef.current = local;
      setReplyDraft(threadId, local);
    }
  };
  // Instance-scoped id: the same thread can render TWO composers (inline at
  // its chunk AND in the section) — a thread-derived id would duplicate and
  // break label/error association.
  const inputId = `${useId()}-reply`;
  const overCap = local.length > MAX_REPLY_LENGTH;
  const blocked = pending || local.trim() === "" || overCap;

  // Quote-reply prefill (BRIEF-56): appended to the LOCAL draft only —
  // same persistence path as typing (blur/unmount/post). Skipped while a
  // post is in flight: the composer is read-only and a mutation would
  // diverge from the captured request body.
  const textareaElement = useRef<HTMLTextAreaElement | null>(null);
  const consumedQuoteNonce = useRef(0);
  useEffect(() => {
    if (quote === undefined || quote.nonce === consumedQuoteNonce.current) {
      return;
    }
    consumedQuoteNonce.current = quote.nonce;
    if (inFlight.current) return;
    dirtyRef.current = true;
    setLocal((current) => appendQuote(current, quote.block));
    window.setTimeout(() => {
      const element = textareaElement.current;
      if (element === null) return;
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    }, 0);
  }, [quote]);

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
    // The in-flight body is durable too (a navigation mid-post keeps it).
    draftRef.current = body;
    setReplyDraft(threadId, body);
    const fail = (copy: string) => {
      setError(copy);
      announce(copy);
    };
    // Outcome (b) of the combo: the reply never landed, so the resolve leg was
    // never reached — say both halves, or the reviewer is left guessing whether
    // the thread closed anyway.
    const replyFailureCopy = (copy: string) =>
      resolveLeg === undefined
        ? copy
        : `${copy} ${COMBO_COPY.replyFailedSuffix}`;
    void (async () => {
      try {
        let result: ReplyResult;
        try {
          result = await post(threadId, body);
        } catch {
          fail(replyFailureCopy(REPLY_COPY.failed));
          return;
        }
        if (result.kind !== "posted") {
          fail(replyFailureCopy(REPLY_FAILURE_COPY[result.kind]));
          return;
        }
        // The external write is the commit point: clear the draft (the
        // reply is GitHub's record now) and let the caller refetch.
        setLocal("");
        localRef.current = "";
        draftRef.current = "";
        dirtyRef.current = false;
        setReplyDraft(threadId, "");
        // Success must persist independent of component lifetime (BRIEF-23
        // rule): the provider may have unmounted while the POST was in
        // flight — clear the DURABLE draft directly too.
        try {
          persistReplyDraft(briefId, threadId, "");
        } catch (persistError) {
          console.error("reply draft: durable clear failed", persistError);
        }
        if (resolveLeg === undefined) {
          announce(REPLY_COPY.posted);
          onPosted();
          return;
        }
        // Sequenced, never parallel: the reply is the commit point and the
        // resolve only makes sense once it landed. The reply leg is NEVER
        // retried from here — a landed reply retried is a double post.
        const outcome = await resolveLeg();
        if (outcome === "resolved") {
          announce(COMBO_COPY.both);
        } else {
          // Outcome (c): partial. The inline copy stays put next to the
          // Resolve button that finishes the job — and stays honest about
          // whether the resolve is KNOWN to have failed or merely unproven.
          fail(
            outcome === "indeterminate"
              ? COMBO_COPY.partialIndeterminate
              : COMBO_COPY.partial,
          );
        }
        // The reply landed either way, so the conversation is stale either
        // way. A same-key invalidation while the resolve leg's own refetch is
        // in flight is deduped by react-query.
        onPosted();
      } finally {
        inFlight.current = false;
        // Focus handoff, decided BEFORE the state update that unmounts the
        // button: the combo retires as soon as it is neither busy nor holding
        // text, and an unmount under the caret drops focus to <body> (Tab then
        // restarts from the top of the page). Recorded here, performed in the
        // effect below — focusing now would land on a node React is about to
        // remove.
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
        label="Reply (posts to GitHub immediately)"
        labelClassName={styles["composerLabel"]}
        exposeTextarea={(element) => {
          textareaElement.current = element;
        }}
        labelVisible
        mentionCandidates={mentionCandidates}
        readOnly={pending}
        value={local}
        onBlur={persist}
        onChange={(value) => {
          dirtyRef.current = true;
          setLocal(value);
        }}
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
      {overCap || error !== null ? (
        <p className={rowStyles["error"]} id={`${inputId}-error`} role="alert">
          {overCap
            ? `This reply is longer than GitHub allows (${MAX_REPLY_LENGTH.toLocaleString()} characters) — shorten it to post.`
            : error}
        </p>
      ) : null}
      <div className={rowStyles["detailActions"]}>
        {/* Focusable-disabled (ReceiptDrawer pattern): a hard `disabled`
            would drop keyboard/SR focus to <body> the moment posting starts
            — and strand it there on success. The click guard lives in
            submit(). */}
        <button
          aria-busy={pendingAction === "reply" || undefined}
          aria-disabled={blocked || undefined}
          className={rowStyles["action"]}
          type="button"
          onClick={() => submit(false)}
        >
          {pendingAction === "reply" ? "Posting…" : "Reply"}
        </button>
        {/* SECONDARY, and only with text in the box: closing a thread you have
            nothing to say on is the standalone Resolve button's job. It also
            stays mounted for its OWN run — the reply leg clears the draft at
            the commit point, and a busy control that vanishes mid-request
            drops both the aria-busy state and the focus sitting on it. */}
        {resolveAfterPost !== undefined &&
        (local.trim() !== "" || pendingAction === "reply-and-resolve") ? (
          <button
            aria-busy={pendingAction === "reply-and-resolve" || undefined}
            aria-disabled={blocked || undefined}
            className={rowStyles["action"]}
            data-testid="reply-and-resolve"
            ref={comboButtonRef}
            type="button"
            onClick={() => submit(true)}
          >
            {pendingAction === "reply-and-resolve"
              ? "Posting & resolving…"
              : "Reply & resolve"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
