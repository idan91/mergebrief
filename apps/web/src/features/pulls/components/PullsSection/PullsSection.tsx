// The picker's DB-backed PR section. Renders one of the three expected
// session states inline — logged-out (login CTA), unavailable (degraded note;
// the local section below still works), ready (PR list or the activation
// hint). Rows are plain anchors carrying the same deep links the PR-comment
// Entry uses.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { GenerationSummary, PrSummary, PullsSession } from "../../types";
import styles from "./PullsSection.module.scss";

export interface PullsSectionProps {
  session: PullsSession;
}

/** Human status for a row — never color-only; rendered as text. */
function statusLabel(
  t: TFunction,
  briefAvailable: boolean,
  generation: GenerationSummary | null,
): string {
  if (briefAvailable) return t("pulls.status.ready");
  if (generation === null) return t("pulls.status.none");
  switch (generation.status) {
    case "queued":
      return t("pulls.status.queued");
    case "running":
      return t("pulls.status.running");
    case "failed":
      return t("pulls.status.failed");
    case "superseded":
      return t("pulls.status.superseded");
    case "capped":
      // The daily generation cap skipped this push — the row says so plainly
      // rather than borrowing the failure word.
      return t("pulls.status.capped");
    case "succeeded":
      // Succeeded but the artifact is for another span — treat as pending.
      return t("pulls.status.none");
  }
}

function rowTitle(t: TFunction, pull: PrSummary): string {
  return pull.title ?? t("pulls.list.fallbackTitle", { number: pull.prNumber });
}

function rowKey(pull: PrSummary): string {
  return `${pull.repoId}#${pull.prNumber}`;
}

export function PullsSection({ session }: PullsSectionProps) {
  const { t } = useTranslation();
  if (session.kind === "logged-out") {
    return (
      <section aria-labelledby="pulls-heading" className={styles["section"]}>
        <h2 className={styles["heading"]} id="pulls-heading">
          {t("pulls.list.heading")}
        </h2>
        <div className={styles["panel"]}>
          <p>{t("pulls.list.signInPrompt")}</p>
          <a className="btn primary" href="/api/auth/github">
            {t("pulls.list.signIn")}
          </a>
        </div>
      </section>
    );
  }

  if (session.kind === "unavailable") {
    return (
      <section aria-labelledby="pulls-heading" className={styles["section"]}>
        <h2 className={styles["heading"]} id="pulls-heading">
          {t("pulls.list.heading")}
        </h2>
        <p className={styles["panel"]} role="status">
          {t("pulls.list.unavailable")}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="pulls-heading" className={styles["section"]}>
      <h2 className={styles["heading"]} id="pulls-heading">
        {t("pulls.list.heading")}
      </h2>
      {session.pulls.length === 0 ? (
        <p className={styles["panel"]}>{t("pulls.list.empty")}</p>
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
                    {statusLabel(t, pull.briefAvailable, pull.generation)}
                  </span>
                  {rowTitle(t, pull)}
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
