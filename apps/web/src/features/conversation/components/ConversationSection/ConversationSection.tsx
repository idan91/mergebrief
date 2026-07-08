// The PR-conversation section (BRIEF-25, ADR 0027): an IN-FLOW section at
// the Brief's end — not a drawer (the drawer is the Receipt's). Verdict
// strip on top, then the digest: threads grouped by chunk in the Brief's
// reading order, unresolved first, bots collapsed per author (never
// hidden). Chips carry TEXT (WCAG 1.4.1) and stay factual — `resolved`
// never dresses as success. Digest rows are ONE keyboard pattern: a plain
// list of `<button aria-expanded>` disclosures.
//
// Live data: refetch on focus/navigation via the query's staleTime, plus
// the manual refresh control here — no background poll. Expansion state is
// keyed by thread id in component state, so it survives refetch (visible
// state, never entry-path memory).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "../../../../components/Markdown/Markdown";
import type { BriefChunk } from "../../../brief/types";
import type { ReviewComment } from "../../../review/comments";
import {
  markSnapshotCommentsSubmitted,
  persistReplyDraft,
} from "../../../review/session";
import { deriveDigestLine } from "../../digestLine";
import {
  buildConversationDigest,
  type DigestGroup,
  type DigestRow,
  type DigestThreadRow,
} from "../../digest";
import { reconcileOwnComments } from "../../ownComments";
import type { conversationQueryOptions } from "../../queries";
import { MAX_REPLY_LENGTH, type ReplyResult } from "../../reply";
import type { ConversationReview, ConversationThread } from "../../types";
import styles from "./ConversationSection.module.scss";

/** The route-injected data plan (absent on the local demo path). */
export interface ConversationPlan {
  readonly queryOptions: ReturnType<typeof conversationQueryOptions>;
  /** Immediate viewer-token reply to a thread's root comment (BRIEF-25 #7). */
  readonly postReply: (
    rootCommentId: number,
    body: string,
  ) => Promise<ReplyResult>;
}

export interface ConversationSectionProps {
  plan: ConversationPlan;
  briefId: string;
  chunks: readonly BriefChunk[];
  localComments: readonly ReviewComment[];
  submittedReviewIds: readonly number[];
  jumpToChunk: (chunkId: string) => void;
  /** Store flip for drafts the reconciliation proved posted (BRIEF-23 residual). */
  markCommentsSubmitted: (ids: readonly string[]) => void;
  /** Page live region — result surfaces must outlive the disclosure. */
  announce: (message: string) => void;
  /** Reply drafts per thread root id (session store — survive navigation). */
  replyDrafts: Readonly<Record<string, string>>;
  setReplyDraft: (threadId: number, body: string) => void;
}

/** Rows shown per digest group before "Show more" (locked decision 6). */
const GROUP_ROW_CAP = 50;

const VERDICT_LABEL: Record<ConversationReview["state"], string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

function threadStateChip(thread: ConversationThread): string {
  // GitHub facts wear GitHub words (locked decision 4). A resolved+outdated
  // thread reads as outdated — that is why it left the code view.
  if (thread.isOutdated) return "outdated";
  return thread.isResolved ? "resolved" : "open";
}

const REPLY_COPY = {
  posted: "Reply posted to GitHub under your account.",
  unauthorized:
    "Your GitHub session expired — sign in again. Your reply draft is saved locally.",
  notFound:
    "This thread is no longer on GitHub — it may have been deleted. Your draft is saved locally.",
  invalid: "The reply was rejected as invalid — reload and try again.",
  upstream: "GitHub rejected the reply or is unreachable — try again shortly.",
  // INDETERMINATE (same discipline as submit): a throw can land after the
  // POST reached GitHub — never claim "nothing was posted".
  failed:
    "Something went wrong posting the reply — it may or may not have posted. Check the thread on GitHub before retrying.",
} as const;

interface ReplyComposerProps {
  briefId: string;
  threadId: number;
  draft: string;
  setDraft: (threadId: number, body: string) => void;
  post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  announce: (message: string) => void;
  onPosted: () => void;
}

function ReplyComposer({
  briefId,
  threadId,
  draft,
  setDraft,
  post,
  announce,
  onPosted,
}: ReplyComposerProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous double-click guard (same as useReviewSubmit): state updates
  // are async, a ref is not — aria-disabled does not block the click event.
  const inFlight = useRef(false);
  // Typing stays LOCAL: a per-keystroke store write would re-render the
  // whole digest and rebuild the receipt memo chain (perf review). The
  // store draft syncs on blur, unmount, and post — the persistence points
  // that matter for surviving navigation.
  const [local, setLocal] = useState(draft);
  const localRef = useRef(local);
  localRef.current = local;
  // Mirrors the STORE's current value (not "what this composer last wrote"):
  // comparing against it means an external reset (Clear local drafts) can't
  // silently un-persist text the user still SEES — behavior follows visible
  // state (Fable review).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    return () => {
      if (localRef.current !== draftRef.current) {
        setDraftRef.current(threadId, localRef.current);
        // The live-store write can race the provider's debounced
        // sessionStorage flush on full navigation — write durably too
        // (codex round 1), best-effort like every direct snapshot write.
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
  const setDraftRef = useRef(setDraft);
  setDraftRef.current = setDraft;
  const persist = () => {
    if (local !== draftRef.current) {
      draftRef.current = local;
      setDraft(threadId, local);
    }
  };
  const inputId = `reply-${threadId}`;
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
    setDraft(threadId, body);
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
        switch (result.kind) {
          case "posted": {
            // The external write is the commit point: clear the draft (the
            // reply is GitHub's record now) and let the caller refetch.
            setLocal("");
            localRef.current = "";
            draftRef.current = "";
            setDraft(threadId, "");
            // Success must persist independent of component lifetime
            // (BRIEF-23 rule): the provider may have unmounted while the
            // POST was in flight — clear the DURABLE draft directly too.
            try {
              persistReplyDraft(briefId, threadId, "");
            } catch (persistError) {
              console.error("reply draft: durable clear failed", persistError);
            }
            announce(REPLY_COPY.posted);
            onPosted();
            break;
          }
          case "unauthorized": {
            fail(REPLY_COPY.unauthorized);
            break;
          }
          case "not-found": {
            fail(REPLY_COPY.notFound);
            break;
          }
          case "invalid": {
            fail(REPLY_COPY.invalid);
            break;
          }
          case "upstream": {
            fail(REPLY_COPY.upstream);
            break;
          }
        }
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    })();
  };

  return (
    <div className={styles["composer"]}>
      <label className={styles["composerLabel"]} htmlFor={inputId}>
        Reply (posts to GitHub immediately)
      </label>
      <textarea
        aria-busy={pending || undefined}
        aria-describedby={
          overCap || error !== null ? `${inputId}-error` : undefined
        }
        aria-invalid={overCap || undefined}
        className={styles["composerInput"]}
        id={inputId}
        readOnly={pending}
        rows={3}
        value={local}
        onBlur={persist}
        onChange={(event) => setLocal(event.target.value)}
      />
      {overCap || error !== null ? (
        <p className={styles["error"]} id={`${inputId}-error`} role="alert">
          {overCap
            ? `This reply is longer than GitHub allows (${MAX_REPLY_LENGTH.toLocaleString()} characters) — shorten it to post.`
            : error}
        </p>
      ) : null}
      <div className={styles["detailActions"]}>
        {/* Focusable-disabled (ReceiptDrawer pattern): a hard `disabled`
            would drop keyboard/SR focus to <body> the moment posting starts
            — and strand it there on success (Fable review). The click guard
            lives in submit(). */}
        <button
          aria-busy={pending || undefined}
          aria-disabled={blocked || undefined}
          className={styles["action"]}
          type="button"
          onClick={submit}
        >
          {pending ? "Posting…" : "Reply"}
        </button>
      </div>
    </div>
  );
}

interface ThreadComposerWiring {
  readonly briefId: string;
  readonly post: (rootCommentId: number, body: string) => Promise<ReplyResult>;
  readonly announce: (message: string) => void;
  readonly drafts: Readonly<Record<string, string>>;
  readonly setDraft: (threadId: number, body: string) => void;
  readonly onPosted: () => void;
}

function ThreadDetail({
  row,
  jumpToChunk,
  composer,
}: {
  row: DigestThreadRow;
  jumpToChunk: (chunkId: string) => void;
  composer: ThreadComposerWiring;
}) {
  const { thread, placement } = row;
  return (
    <div className={styles["detail"]}>
      {thread.comments.map((comment) => (
        <article
          aria-label={`Comment by ${comment.author.login}`}
          className={styles["comment"]}
          key={comment.commentId}
        >
          <header className={styles["commentHead"]}>
            <span className={styles["author"]}>
              @{comment.author.login}
              {comment.author.isBot ? (
                <span className={styles["botTag"]}>bot</span>
              ) : null}
            </span>
            <time dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleDateString()}
            </time>
          </header>
          <Markdown content={comment.body} />
        </article>
      ))}
      {thread.hasMoreComments ? (
        <p className={styles["note"]}>Longer thread — the rest is on GitHub.</p>
      ) : null}
      <div className={styles["detailActions"]}>
        {placement.kind === "chunk" ? (
          <button
            className={styles["action"]}
            type="button"
            onClick={() => jumpToChunk(placement.chunkId)}
          >
            Jump to chunk
          </button>
        ) : null}
        <a
          className={styles["action"]}
          href={thread.comments[0]?.url}
          rel="noreferrer"
          target="_blank"
        >
          View on GitHub
          <span className={styles["srOnly"]}> (opens in a new tab)</span>
        </a>
      </div>
      <ReplyComposer
        announce={composer.announce}
        briefId={composer.briefId}
        draft={composer.drafts[String(thread.rootCommentId)] ?? ""}
        onPosted={composer.onPosted}
        post={composer.post}
        setDraft={composer.setDraft}
        threadId={thread.rootCommentId}
      />
    </div>
  );
}

function ThreadRowView({
  row,
  expanded,
  toggle,
  jumpToChunk,
  composer,
}: {
  row: DigestThreadRow;
  expanded: boolean;
  toggle: (threadId: number) => void;
  jumpToChunk: (chunkId: string) => void;
  composer: ThreadComposerWiring;
}) {
  const { thread } = row;
  const author = thread.comments[0]?.author;
  return (
    <li className={styles["row"]}>
      <button
        aria-expanded={expanded}
        className={styles["rowButton"]}
        type="button"
        onClick={() => toggle(thread.rootCommentId)}
      >
        <span className={styles["chip"]} data-state={threadStateChip(thread)}>
          {threadStateChip(thread)}
        </span>
        <span className={styles["rowAuthor"]}>@{author?.login}</span>
        <span className={styles["rowLine"]}>{row.digestLine}</span>
        {row.isOwn ? <span className={styles["ownTag"]}>yours</span> : null}
        {row.anchorLabel !== undefined ? (
          <span className={styles["revision"]}>at {row.anchorLabel}</span>
        ) : null}
        <span className={styles["count"]}>
          {thread.comments.length > 1
            ? `${thread.comments.length} comments`
            : null}
        </span>
      </button>
      {expanded ? (
        <ThreadDetail composer={composer} jumpToChunk={jumpToChunk} row={row} />
      ) : null}
    </li>
  );
}

function BotGroupRowView({
  row,
  groupId,
  expandedGroups,
  toggleGroup,
  expandedThreads,
  toggleThread,
  jumpToChunk,
  composer,
}: {
  row: Extract<DigestRow, { kind: "bot-group" }>;
  groupId: string;
  expandedGroups: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
  expandedThreads: ReadonlySet<number>;
  toggleThread: (threadId: number) => void;
  jumpToChunk: (chunkId: string) => void;
  composer: ThreadComposerWiring;
}) {
  const key = `${groupId}:${row.author}`;
  const expanded = expandedGroups.has(key);
  // The collapsed chip must stay factual for the WHOLE group (codex rounds
  // 1-2): an all-outdated group reads outdated even when its threads are
  // unresolved (outdated is WHY they left the code view); otherwise open
  // wins over resolved.
  const groupChip = row.threads.every(
    (threadRow) => threadRow.thread.isOutdated,
  )
    ? "outdated"
    : row.openCount > 0
      ? "open"
      : "resolved";
  return (
    <li className={styles["row"]}>
      <button
        aria-expanded={expanded}
        className={styles["rowButton"]}
        type="button"
        onClick={() => toggleGroup(key)}
      >
        <span className={styles["chip"]} data-state={groupChip}>
          {groupChip}
        </span>
        <span className={styles["rowAuthor"]}>
          @{row.author}
          <span className={styles["botTag"]}>bot</span>
        </span>
        <span className={styles["rowLine"]}>
          {row.threads.length} threads · {row.openCount} open
        </span>
      </button>
      {expanded ? (
        <ul className={styles["nested"]}>
          {row.threads.map((threadRow) => (
            <ThreadRowView
              composer={composer}
              expanded={expandedThreads.has(threadRow.thread.rootCommentId)}
              jumpToChunk={jumpToChunk}
              key={threadRow.thread.rootCommentId}
              row={threadRow}
              toggle={toggleThread}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DigestGroupView({
  group,
  expandedThreads,
  toggleThread,
  expandedGroups,
  toggleGroup,
  shownAll,
  showAll,
  jumpToChunk,
  composer,
}: {
  group: DigestGroup;
  expandedThreads: ReadonlySet<number>;
  toggleThread: (threadId: number) => void;
  expandedGroups: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
  shownAll: boolean;
  showAll: (groupId: string) => void;
  jumpToChunk: (chunkId: string) => void;
  composer: ThreadComposerWiring;
}) {
  const rows = shownAll ? group.rows : group.rows.slice(0, GROUP_ROW_CAP);
  const hidden = group.rows.length - rows.length;
  // PR-level comments share the group's ~50-row budget and the SAME
  // disclosure pattern (codex round 3) — no second interaction model.
  const allPrComments = group.prComments ?? [];
  const prCommentBudget = Math.max(0, GROUP_ROW_CAP - rows.length);
  const prComments = shownAll
    ? allPrComments
    : allPrComments.slice(0, prCommentBudget);
  const hiddenPrComments = allPrComments.length - prComments.length;
  return (
    <section aria-label={group.label} className={styles["group"]}>
      <h3 className={styles["groupLabel"]}>
        {group.kind === "chunk" && group.chunkId !== undefined ? (
          <button
            className={styles["groupJump"]}
            type="button"
            onClick={() => {
              if (group.chunkId !== undefined) jumpToChunk(group.chunkId);
            }}
          >
            {group.label}
          </button>
        ) : (
          group.label
        )}
      </h3>
      <ul className={styles["rows"]}>
        {rows.map((row) =>
          row.kind === "thread" ? (
            <ThreadRowView
              composer={composer}
              expanded={expandedThreads.has(row.thread.rootCommentId)}
              jumpToChunk={jumpToChunk}
              key={row.thread.rootCommentId}
              row={row}
              toggle={toggleThread}
            />
          ) : (
            <BotGroupRowView
              composer={composer}
              expandedGroups={expandedGroups}
              expandedThreads={expandedThreads}
              groupId={group.id}
              jumpToChunk={jumpToChunk}
              key={`${group.id}:${row.author}`}
              row={row}
              toggleGroup={toggleGroup}
              toggleThread={toggleThread}
            />
          ),
        )}
      </ul>
      {hidden > 0 ? (
        <button
          className={styles["action"]}
          type="button"
          onClick={() => showAll(group.id)}
        >
          Show {hidden} more
        </button>
      ) : null}
      {prComments.length > 0 ? (
        <ul className={styles["rows"]}>
          {prComments.map((comment) => (
            <li className={styles["row"]} key={comment.commentId}>
              <button
                aria-expanded={expandedThreads.has(comment.commentId)}
                className={styles["rowButton"]}
                type="button"
                onClick={() => toggleThread(comment.commentId)}
              >
                <span className={styles["rowAuthor"]}>
                  @{comment.author.login}
                  {comment.author.isBot ? (
                    <span className={styles["botTag"]}>bot</span>
                  ) : null}
                </span>
                <span className={styles["rowLine"]}>
                  {deriveDigestLine(comment.body)}
                </span>
              </button>
              {expandedThreads.has(comment.commentId) ? (
                <div className={styles["detail"]}>
                  <Markdown content={comment.body} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {hiddenPrComments > 0 ? (
        <button
          className={styles["action"]}
          type="button"
          onClick={() => showAll(group.id)}
        >
          Show {hiddenPrComments} more
        </button>
      ) : null}
    </section>
  );
}

/**
 * The in-flow conversation section. Error states are SPECIFIC (locked
 * design constraint); the empty state teaches. Own threads carry a
 * "yours" tag from the review-id reconciliation, and drafts the
 * reconciliation proved posted flip to submitted (server-backed wins).
 */
export function ConversationSection({
  plan,
  briefId,
  chunks,
  localComments,
  submittedReviewIds,
  jumpToChunk,
  markCommentsSubmitted,
  announce,
  replyDrafts,
  setReplyDraft,
}: ConversationSectionProps) {
  const queryClient = useQueryClient();
  const query = useQuery(plan.queryOptions);
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [shownAllGroups, setShownAllGroups] = useState<ReadonlySet<string>>(
    new Set(),
  );
  // Ids already flipped this mount — the reconciliation effect must never
  // loop (a flip changes localComments, which recomputes the reconcile).
  const flippedRef = useRef<Set<string>>(new Set());

  const conversation =
    query.data?.kind === "ready" ? query.data.conversation : undefined;

  const reconciliation = useMemo(
    () =>
      conversation === undefined
        ? undefined
        : reconcileOwnComments(
            localComments,
            conversation.threads,
            submittedReviewIds,
          ),
    [conversation, localComments, submittedReviewIds],
  );

  useEffect(() => {
    if (reconciliation === undefined) return;
    const ids = reconciliation.resurrectedDraftIds.filter(
      (id) => !flippedRef.current.has(id),
    );
    if (ids.length === 0) return;
    for (const id of ids) flippedRef.current.add(id);
    // Server-backed wins: these drafts ARE on GitHub. Live flip + durable
    // write (the provider may outlive neither — same discipline as submit).
    markCommentsSubmitted(ids);
    try {
      markSnapshotCommentsSubmitted(briefId, ids);
    } catch (persistError) {
      console.error("conversation: durable flip failed", persistError);
    }
  }, [briefId, markCommentsSubmitted, reconciliation]);

  const digest = useMemo(
    () =>
      conversation === undefined
        ? []
        : buildConversationDigest({
            conversation,
            chunks,
            ownThreadIds: reconciliation?.ownThreadIds ?? new Set(),
          }),
    [chunks, conversation, reconciliation],
  );

  const toggleThread = (threadId: number) =>
    setExpandedThreads((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  const toggleGroup = (key: string) =>
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const showAll = (groupId: string) =>
    setShownAllGroups((current) => new Set(current).add(groupId));

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: plan.queryOptions.queryKey,
    });

  // Every conversation write evicts server-side; the post-reply refetch
  // makes the reply visible in-section (locked decision 9).
  const composer: ThreadComposerWiring = {
    briefId,
    post: plan.postReply,
    announce,
    drafts: replyDrafts,
    setDraft: setReplyDraft,
    onPosted: refresh,
  };

  const verdicts =
    conversation?.reviews.filter(
      (review) => review.state !== "COMMENTED" || review.body.trim() !== "",
    ) ?? [];

  return (
    <section
      aria-labelledby="conversation-heading"
      className={styles["section"]}
      data-conversation-section
    >
      <div className={styles["head"]}>
        <h2 className={styles["heading"]} id="conversation-heading">
          Conversation
        </h2>
        <button
          className={styles["action"]}
          disabled={query.isFetching}
          type="button"
          onClick={refresh}
        >
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {query.isPending ? (
        <p className={styles["note"]} role="status">
          Loading the conversation…
        </p>
      ) : null}
      {query.isError ? (
        <p className={styles["error"]} role="alert">
          The conversation could not be read (unexpected response). Refresh to
          retry.
        </p>
      ) : null}
      {query.data?.kind === "unauthorized" ? (
        <p className={styles["error"]} role="alert">
          Your GitHub session expired — sign in again to see the conversation.
        </p>
      ) : null}
      {query.data?.kind === "not-found" ? (
        <p className={styles["error"]} role="alert">
          This pull request&apos;s conversation is no longer accessible on
          GitHub.
        </p>
      ) : null}
      {query.data?.kind === "unavailable" ? (
        <p className={styles["error"]} role="alert">
          GitHub (or the backend) is unreachable — the conversation could not be
          fetched. Refresh to retry.
        </p>
      ) : null}

      {conversation !== undefined ? (
        <>
          {verdicts.length > 0 ? (
            <ul aria-label="Review verdicts" className={styles["verdicts"]}>
              {verdicts.map((review) => (
                <li className={styles["verdict"]} key={review.reviewId}>
                  <span className={styles["author"]}>
                    @{review.author.login}
                    {review.author.isBot ? (
                      <span className={styles["botTag"]}>bot</span>
                    ) : null}
                  </span>
                  <span
                    className={styles["chip"]}
                    data-state={VERDICT_LABEL[review.state]}
                  >
                    {VERDICT_LABEL[review.state]}
                  </span>
                  {review.body.trim() !== "" ? (
                    <span className={styles["rowLine"]}>{review.body}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {digest.length === 0 && verdicts.length === 0 ? (
            <p className={styles["note"]}>
              No conversation yet — comments land here as teammates review.
            </p>
          ) : null}

          {digest.map((group) => (
            <DigestGroupView
              composer={composer}
              expandedGroups={expandedGroups}
              expandedThreads={expandedThreads}
              group={group}
              jumpToChunk={jumpToChunk}
              key={group.id}
              showAll={showAll}
              shownAll={shownAllGroups.has(group.id)}
              toggleGroup={toggleGroup}
              toggleThread={toggleThread}
            />
          ))}

          {conversation.hasMoreThreads ||
          conversation.hasMoreReviews ||
          conversation.hasMorePrComments ? (
            <p className={styles["note"]}>
              This conversation is unusually large — some items are only on
              GitHub.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
