// PROTOTYPE (BRIEF-381): the held Entry comment as GitHub would render its
// markdown. Content and order are settled; this only renders them.
import {
  type HeldCase,
  type PlainCondition,
  describeCondition,
  describeOwner,
  sortConditions,
} from "../model";
import styles from "./EntryPreview.module.scss";

function MemberLines({ condition }: { condition: PlainCondition }) {
  const owner = describeOwner(condition.source);
  return (
    <>
      {describeCondition(condition, 3).map((line) => (
        <li key={line}>
          {line} <span className={styles["owner"]}>({owner}&apos;s setting)</span>
        </li>
      ))}
    </>
  );
}

export interface EntryPreviewProps {
  held: HeldCase;
}

export function EntryPreview({ held }: EntryPreviewProps) {
  const sorted = sortConditions(held.unmet);
  return (
    <section aria-label="Entry comment preview" className={styles["frame"]}>
      <p className={styles["caption"]}>
        Entry comment on {held.repo}#{held.prNumber}, as GitHub renders it. Edited in place while held; no ping.
      </p>
      <article className={styles["comment"]}>
        <header className={styles["head"]}>
          <span className={styles["avatar"]} aria-hidden="true" />
          <strong>mergebrief</strong>
          <span className={styles["bot"]}>bot</span>
          <span className={styles["meta"]}>commented · edited</span>
        </header>
        <div className={styles["body"]}>
          <p>
            <strong>
              No brief for <code>{held.sha}</code>.
            </strong>
          </p>
          <ul>
            {sorted.map((condition) =>
              condition.kind === "any" ? (
                <li key="any">
                  Needs one of these:
                  <ul>
                    {condition.conditions.map((member) => (
                      <MemberLines condition={member} key={JSON.stringify(member)} />
                    ))}
                  </ul>
                </li>
              ) : (
                <MemberLines condition={condition} key={JSON.stringify(condition)} />
              ),
            )}
          </ul>
          <p>
            <a href="#generate">Generate now</a>
            {held.previousSha === undefined ? null : (
              <>
                {" · "}
                <a href="#previous">
                  Brief for <code>{held.previousSha}</code>
                </a>
              </>
            )}
          </p>
        </div>
      </article>
    </section>
  );
}
