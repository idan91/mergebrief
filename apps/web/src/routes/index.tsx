import { useTranslation } from "react-i18next";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { generateBrief } from "../features/brief/server/brief.functions";
import {
  generateBriefViaApi,
  localBriefsQueryOptions,
} from "../features/brief/queries";
import { briefErrorDetail } from "@web/features/brief/utils/briefErrors";
import { OrgSwitcher } from "@web/features/installations";
import { LocalePicker } from "../i18n/LocalePicker/LocalePicker";
import { PullsSection } from "@web/features/pulls";
import { pullsSessionQueryOptions } from "../features/pulls/queries";
import sharedStyles from "./routeShared.module.scss";
import styles from "./index.module.scss";

export const Route = createFileRoute("/")({
  // Both lists prefetch in parallel — the session list SSRs through the
  // in-process apiFetch interface (same authz gate), never a client waterfall.
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(localBriefsQueryOptions()),
      context.queryClient.ensureQueryData(pullsSessionQueryOptions()),
    ]),
  component: BriefPicker,
  errorComponent: BriefPickerError,
});

// A command the reader copies verbatim — an identifier, not copy.
const CLI_COMMAND = "pnpm categorize <pr-url>";

// The product name — an identifier, never translated.
const PRODUCT_NAME = "MergeBrief";
const PRODUCT_SUFFIX = " / review";

function BriefPicker() {
  const { t } = useTranslation();
  const briefs = useSuspenseQuery(localBriefsQueryOptions()).data;
  const session = useSuspenseQuery(pullsSessionQueryOptions()).data;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      // Behavior follows the VISIBLE auth state: signed in generates through
      // the api route on the viewer's token; signed out uses the local gh CLI.
      const briefId =
        session.kind === "ready"
          ? await generateBriefViaApi(url)
          : await generateBrief({ data: { url } });
      // The list is cached with staleTime Infinity — a fresh brief must
      // invalidate it or the picker shows the load-time snapshot.
      await queryClient.invalidateQueries({ queryKey: ["briefs", "local"] });
      await navigate({ to: "/briefs/$briefId", params: { briefId } });
    } catch (caught) {
      // The server function rejects with a CODE, never a sentence — render
      // it through the catalog (unmapped reasons fall back to the unexpected
      // line) rather than putting a raw token in a `role="alert"`.
      setError(briefErrorDetail(t, caught));
      setPending(false);
    }
  }

  return (
    <main className={styles["pickerMain"]} id="main-content" tabIndex={-1}>
      <section className={styles["picker"]}>
        <div className={styles["topBar"]}>
          <div className={styles["wordmark"]}>
            {PRODUCT_NAME}
            <span>{PRODUCT_SUFFIX}</span>
          </div>
          <LocalePicker />
        </div>
        <div className={styles["eyebrow"]}>{t("shell.landingEyebrow")}</div>
        <h1>{t("shell.landingHeading")}</h1>
        <p className={styles["copy"]}>{t("shell.landingCopy")}</p>
        <ul className={styles["pillars"]}>
          <li>{t("shell.landingBullet1")}</li>
          <li>{t("shell.landingBullet2")}</li>
          <li>{t("shell.landingBullet3")}</li>
        </ul>
        <form className={styles["form"]} onSubmit={handleGenerate}>
          <input
            aria-label={t("shell.ariaLabelPrUrl")}
            disabled={pending}
            placeholder={t("shell.prUrlPlaceholder")}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button className="btn primary" disabled={pending} type="submit">
            {pending ? t("shell.generating") : t("shell.generate")}
          </button>
        </form>
        {error ? (
          <p className={styles["error"]} role="alert">
            {error}
          </p>
        ) : null}
        <OrgSwitcher enabled={session.kind === "ready"} />
        <PullsSection session={session} />
        {briefs.length === 0 ? (
          <div className={styles["empty"]}>
            <p>{t("shell.noBriefs")}</p>
            <p>
              {t("shell.cliHintLead")} <code>{CLI_COMMAND}</code>{" "}
              {t("shell.cliHintTail")}
            </p>
          </div>
        ) : (
          <>
            <h2 className={styles["listLabel"]}>{t("shell.localBriefs")}</h2>
            <ul className={styles["list"]}>
              {briefs.map((brief) => (
                <li key={brief.id}>
                  <Link
                    className={styles["link"]}
                    params={{ briefId: brief.id }}
                    to="/briefs/$briefId"
                  >
                    <span className={styles["linkTitle"]}>
                      <span
                        className={styles["artifactPill"]}
                        data-kind={brief.artifactKind}
                      >
                        {brief.artifactKind === "delta"
                          ? t("shell.artifactDelta")
                          : t("shell.artifactBrief")}
                      </span>
                      {brief.title}
                    </span>
                    <span className={styles["meta"]}>
                      {brief.repo} #{brief.number} · {brief.id} ·{" "}
                      {brief.artifactKind === "delta" &&
                      brief.baselineSha &&
                      brief.headSha
                        ? `${brief.baselineSha.slice(0, 7)} → ${brief.headSha.slice(0, 7)}`
                        : brief.sha.slice(0, 7)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function BriefPickerError({ error }: { error: Error }) {
  const { t } = useTranslation();
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={sharedStyles["errorState"]}>
        <h1>{t("shell.briefListFailed")}</h1>
        {/* Curated copy only: a raw server message would leak internals. */}
        <p>{briefErrorDetail(t, error)}</p>
      </section>
    </main>
  );
}
