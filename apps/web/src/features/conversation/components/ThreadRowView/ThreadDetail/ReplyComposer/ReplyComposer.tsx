import { useEffect, useId, useRef, useState } from "react";

import { MarkdownTextarea } from "@web/components/MarkdownTextarea/MarkdownTextarea";
import {
  persistReplyDraft,
  useMindMap,
  useMindMapActions,
  useReviewActions,
} from "@web/features/review/session";
import { MAX_REPLY_LENGTH, type ReplyResult } from "../../../../reply";
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

export interface ReplyComposerProps {
  briefId: string;
  threadId: number;
  post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  onPosted: () => void;
  /** Mention-autocomplete pool (thread participants — BRIEF-56). */
  mentionCandidates?: readonly string[] | undefined;
}

export function ReplyComposer({
  briefId,
  threadId,
  post,
  onPosted,
  mentionCandidates,
}: ReplyComposerProps) {
  // Draft reads/writes go straight to the session stores (the PR 3 wiring
  // re-shape): no draft prop chain through the digest tree.
  const draft = useMindMap(
    (state) => state.replyDrafts[String(threadId)] ?? "",
  );
  const { setReplyDraft } = useMindMapActions();
  const { announce } = useReviewActions();
  const [pending, setPending] = useState(false);
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

  const submit = () => {
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
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
    void (async () => {
      try {
        let result: ReplyResult;
        try {
          result = await post(threadId, body);
        } catch {
          fail(REPLY_COPY.failed);
          return;
        }
        if (result.kind !== "posted") {
          fail(REPLY_FAILURE_COPY[result.kind]);
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
        announce(REPLY_COPY.posted);
        onPosted();
      } finally {
        inFlight.current = false;
        setPending(false);
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
        onSubmit={submit}
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
          aria-busy={pending || undefined}
          aria-disabled={blocked || undefined}
          className={rowStyles["action"]}
          type="button"
          onClick={submit}
        >
          {pending ? "Posting…" : "Reply"}
        </button>
      </div>
    </div>
  );
}
