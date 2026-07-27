// Inline thread disclosures at a chunk (BRIEF-25, locked decisions 2/6):
// fresh threads render AT the code they discuss — humans per thread, bots as
// ONE aggregated disclosure per bot (unresolved only; resolved/outdated bot
// threads are digest-only). Same keyboard pattern as the section: a plain
// list of aria-expanded disclosure buttons. Expansion state is local to the
// chunk instance (visible state, never entry-path memory).
import { useState } from "react";

import { toggleSet } from "@web/utils/collections";
import type { DigestRow } from "../../digest";
import type { ThreadComposerWiring } from "../../wiring";
import { ThreadRowView } from "../ThreadRowView/ThreadRowView";
import styles from "./InlineThreads.module.scss";

// Inline rows already sit at their chunk — the detail's jump is hidden, so
// this callback is never reachable from here.
const noJump = () => undefined;

export interface InlineThreadsProps {
  rows: readonly DigestRow[];
  composer: ThreadComposerWiring;
}

export function InlineThreads({ rows, composer }: InlineThreadsProps) {
  const [expandedThreads, setExpandedThreads] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [expandedBots, setExpandedBots] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const toggleThread = (threadId: number) =>
    setExpandedThreads((current) => toggleSet(current, threadId));
  const toggleBot = (author: string) =>
    setExpandedBots((current) => toggleSet(current, author));
  if (rows.length === 0) return null;
  return (
    <section
      aria-label="Conversation at this chunk"
      className={styles["inline"]}
    >
      <h4 className={styles["label"]}>Conversation</h4>
      <ul className={styles["rows"]}>
        {rows.map((row) =>
          row.kind === "thread" ? (
            <ThreadRowView
              composer={composer}
              expanded={expandedThreads.has(row.thread.rootCommentId)}
              hideJump
              jumpToChunk={noJump}
              key={row.thread.rootCommentId}
              row={row}
              toggle={toggleThread}
            />
          ) : (
            <li className={styles["row"]} key={row.author}>
              <button
                aria-expanded={expandedBots.has(row.author)}
                className={styles["botButton"]}
                type="button"
                onClick={() => toggleBot(row.author)}
              >
                @{row.author}
                <span className={styles["botTag"]}>bot</span>
                <span className={styles["botSummary"]}>
                  {row.threads.length} open thread
                  {row.threads.length === 1 ? "" : "s"}
                </span>
              </button>
              {expandedBots.has(row.author) ? (
                <ul className={styles["rows"]}>
                  {row.threads.map((threadRow) => (
                    <ThreadRowView
                      composer={composer}
                      expanded={expandedThreads.has(
                        threadRow.thread.rootCommentId,
                      )}
                      hideJump
                      jumpToChunk={noJump}
                      key={threadRow.thread.rootCommentId}
                      row={threadRow}
                      toggle={toggleThread}
                    />
                  ))}
                </ul>
              ) : null}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
