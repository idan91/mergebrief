// The picker's DB-backed PR section (BRIEF-19 PR 3.1). Renders one of the
// three expected session states inline — logged-out (login CTA), unavailable
// (degraded note; the local section below still works), ready (PR list or the
// activation hint). Rows are plain anchors: the target route
// (/repos/:repoId/pulls/:prNumber) ships in PR 3.2, and these URLs are the
// same deep links the PR-comment Entry uses.
import type { GenerationSummary, PrSummary, PullsSession } from "../../types";
import styles from "./PullsSection.module.scss";

export interface PullsSectionProps {
  session: PullsSession;
}

/** Human status for a row — never color-only; rendered as text. */
function statusLabel(
  briefAvailable: boolean,
  generation: GenerationSummary | null,
): string {
  if (briefAvailable) return "brief ready";
  if (generation === null) return "no brief yet";
  switch (generation.status) {
    case "queued":
      return "queued";
    case "running":
      return "generating…";
    case "failed":
      return "failed";
    case "superseded":
      return "newer push on the way";
    case "succeeded":
      // Succeeded but the artifact is for another span — treat as pending.
      return "no brief yet";
  }
}

function rowTitle(pull: PrSummary): string {
  return pull.title ?? `PR #${pull.prNumber}`;
}

function rowKey(pull: PrSummary): string {
  return `${pull.repoId}#${pull.prNumber}`;
}

export function PullsSection({ session }: PullsSectionProps) {
  if (session.kind === "logged-out") {
    return (
      <section aria-labelledby="pulls-heading" className={styles["section"]}>
        <h2 className={styles["heading"]} id="pulls-heading">
          Pull requests
        </h2>
        <div className={styles["panel"]}>
          <p>
            Sign in with GitHub to read Briefs for the repositories where the
            App is installed.
          </p>
          <a className="btn primary" href="/api/auth/github">
            Sign in with GitHub
          </a>
        </div>
      </section>
    );
  }

  if (session.kind === "unavailable") {
    return (
      <section aria-labelledby="pulls-heading" className={styles["section"]}>
        <h2 className={styles["heading"]} id="pulls-heading">
          Pull requests
        </h2>
        <p className={styles["panel"]} role="status">
          The PR list is unavailable right now (GitHub or the backend could not
          be reached). Local Briefs below still work — try again shortly.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="pulls-heading" className={styles["section"]}>
      <h2 className={styles["heading"]} id="pulls-heading">
        Pull requests
      </h2>
      {session.pulls.length === 0 ? (
        <p className={styles["panel"]}>
          No pull requests yet. Push to a pull request in a repository where the
          App is installed and its Brief generates automatically.
        </p>
      ) : (
        <ul className={styles["list"]}>
          {session.pulls.map((pull) => (
            <li key={rowKey(pull)}>
              <a
                className={styles["row"]}
                href={`/repos/${encodeURIComponent(pull.repoId)}/pulls/${String(pull.prNumber)}`}
              >
                <span className={styles["rowTitle"]}>
                  <span
                    className={styles["statusPill"]}
                    data-status={
                      pull.briefAvailable
                        ? "ready"
                        : (pull.generation?.status ?? "none")
                    }
                  >
                    {statusLabel(pull.briefAvailable, pull.generation)}
                  </span>
                  {rowTitle(pull)}
                </span>
                <span className={styles["meta"]}>
                  {pull.repoSlug ?? pull.repoId} #{pull.prNumber} · {pull.state}
                  {pull.headSha === null
                    ? null
                    : ` · ${pull.headSha.slice(0, 7)}`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
