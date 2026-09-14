// The picker's "your briefs" section: the DB-backed list of the viewer's own
// url-box briefs. Signed-out renders nothing (the pulls section already
// carries the login CTA); rows deep-link to the repo route and carry the
// owner-delete affordance.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@web/components/Button/Button";
import type {
  GenerationSummary,
  PrState,
  PrSummary,
  PullsSession,
} from "../../types";
import { buildRowKey, useYourBriefs } from "./useYourBriefs";
import styles from "./YourBriefsSection.module.scss";

export interface YourBriefsSectionProps {
  session: PullsSession;
}

/** Human status for a row, never color-only; rendered as text. */
function statusLabel(
  t: TFunction,
  briefAvailable: boolean,
  generation: GenerationSummary | null,
): string {
  if (briefAvailable) return t("pulls.status.ready");
  if (generation === null) return t("pulls.status.none");
  switch (generation.status) {
    case "pending":
      return t("pulls.status.pending");
    case "running":
      return t("pulls.status.running");
    case "failed":
      return t("pulls.status.failed");
    case "superseded":
      return t("pulls.status.superseded");
    case "capped":
      return t("pulls.status.capped");
    case "succeeded":
      return t("pulls.status.none");
  }
}

/** The PR's lifecycle as copy; the wire token is never rendered raw. */
function stateLabel(t: TFunction, state: PrState): string {
  switch (state) {
    case "open":
      return t("pulls.state.open");
    case "closed":
      return t("pulls.state.closed");
    case "merged":
      return t("pulls.state.merged");
  }
}

function rowTitle(t: TFunction, pull: PrSummary): string {
  return pull.title ?? t("pulls.list.fallbackTitle", { number: pull.prNumber });
}

export function YourBriefsSection({ session }: YourBriefsSectionProps) {
  const { t } = useTranslation();
  const flow = useYourBriefs();
  // Signed out means no owner world to list; unavailable degrades quietly, as the
  // pulls section on the same page already surfaces the backend state.
  if (session.kind !== "ready") {
    return null;
  }

  return (
    <section
      aria-labelledby="your-briefs-heading"
      className={styles["section"]}
    >
      <h2 className={styles["heading"]} id="your-briefs-heading">
        {t("pulls.yourBriefs.heading")}
      </h2>
      {session.pulls.length === 0 ? (
        <p className={styles["panel"]}>{t("pulls.yourBriefs.empty")}</p>
      ) : (
        <ul className={styles["list"]}>
          {session.pulls.map((pull) => {
            const key = buildRowKey(pull.repoId, pull.prNumber);
            const deleting = flow.deletePendingKey === key;
            return (
              <li className={styles["rowShell"]} key={key}>
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
                    {pull.repoSlug ?? pull.repoId} #{pull.prNumber} ·{" "}
                    {stateLabel(t, pull.state)}
                    {pull.headSha === null
                      ? null
                      : ` · ${pull.headSha.slice(0, 7)}`}
                  </span>
                </a>
                <Button
                  aria-label={t("pulls.yourBriefs.ariaDelete", {
                    repo: pull.repoSlug ?? pull.repoId,
                    number: pull.prNumber,
                  })}
                  disabled={deleting}
                  loading={deleting}
                  size="sm"
                  onClick={() => flow.requestDelete(pull.repoId, pull.prNumber)}
                >
                  {deleting
                    ? t("pulls.yourBriefs.deleting")
                    : t("pulls.yourBriefs.delete")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {flow.deleteFailed ? (
        <p className={styles["panel"]} role="alert">
          {t("pulls.yourBriefs.deleteFailed")}
        </p>
      ) : null}
    </section>
  );
}
