import { useTranslation } from "react-i18next";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { Button } from "@web/components/Button/Button";
import {
  generateBriefViaApi,
  buildLocalBriefsQueryOptions,
} from "../features/brief/queries";
import { briefErrorDetail } from "@web/features/brief/utils";
import { LocalBriefsSection } from "@web/features/brief";
import { OrgSwitcher } from "@web/features/installations";
import { LocalePicker } from "../i18n/LocalePicker/LocalePicker";
import { PullsSection, YourBriefsSection } from "@web/features/pulls";
import { getPullsRefetchInterval } from "@web/features/pulls/utils";
import {
  buildPullsSessionQueryOptions,
  buildUrlBriefsQueryOptions,
} from "../features/pulls/queries";
import sharedStyles from "./routeShared.module.scss";
import { appI18n } from "../i18n/I18nProvider";
import { buildPageTitle } from "@web/utils/pageTitle";
import styles from "./index.module.scss";

export const Route = createFileRoute("/")({
  // Both lists prefetch in parallel, the session list SSRs through the
  // in-process apiFetch interface (same authz gate), never a client waterfall.
  loader: async ({ context }) => {
    const prefetches: Promise<unknown>[] = [
      context.queryClient.ensureQueryData(buildUrlBriefsQueryOptions()),
      context.queryClient.ensureQueryData(buildPullsSessionQueryOptions()),
    ];
    // The DEV file surface, prefetched only behind a session (the readers
    // refuse without one) and never allowed to fail the page. The `if` is a
    // build-time constant, so production keeps the original two.
    if (!import.meta.env.PROD) {
      prefetches.push(
        context.queryClient
          .ensureQueryData(buildPullsSessionQueryOptions())
          .then((session) =>
            session.kind === "ready"
              ? context.queryClient.ensureQueryData(
                  buildLocalBriefsQueryOptions(),
                )
              : undefined,
          )
          .catch(() => undefined),
      );
    }
    await Promise.all(prefetches);
  },
  head: () => {
    const pageName = appI18n.t("shell.pageTitle.home");

    return { meta: [{ title: buildPageTitle(appI18n.t, [pageName]) }] };
  },
  component: BriefPicker,
  errorComponent: BriefPickerError,
});

// The product name, an identifier, never translated.
const PRODUCT_NAME = "MergeBrief";
const PRODUCT_SUFFIX = " / review";

function BriefPicker() {
  const { t } = useTranslation();
  const yourBriefs = useSuspenseQuery({
    ...buildUrlBriefsQueryOptions(),
    refetchInterval: (query) => getPullsRefetchInterval(query.state.data),
  }).data;
  const session = useSuspenseQuery({
    ...buildPullsSessionQueryOptions(),
    refetchInterval: (query) => getPullsRefetchInterval(query.state.data),
  }).data;
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      // Signed-in only: the api door resolves with the viewer's token and
      // enqueues the worker; the repo route's meta poll shows progress. The
      // signed-out gh-CLI door is gone, the box asks for sign-in instead.
      const accepted = await generateBriefViaApi(url);
      await navigate({
        to: "/repos/$repoId/pulls/$prNumber",
        params: {
          repoId: accepted.repoId,
          prNumber: String(accepted.prNumber),
        },
      });
    } catch (caught) {
      // The server function rejects with a CODE, never a sentence, render
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
        {/* The url-box is a signed-in door: the worker generates with the
            viewer's grant, so a signed-out visitor gets the sign-in button
            below instead of a dead form. */}
        {session.kind === "ready" ? (
          <form className={styles["form"]} onSubmit={handleGenerate}>
            <input
              aria-label={t("shell.ariaLabelPrUrl")}
              disabled={pending}
              placeholder={t("shell.prUrlPlaceholder")}
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button
              disabled={pending}
              loading={pending}
              type="submit"
              variant="primary"
            >
              {pending ? t("shell.generating") : t("shell.generate")}
            </Button>
          </form>
        ) : null}
        {error ? (
          <p className={styles["error"]} role="alert">
            {error}
          </p>
        ) : null}
        <OrgSwitcher enabled={session.kind === "ready"} />
        <YourBriefsSection session={yourBriefs} />
        <PullsSection session={session} />
        {import.meta.env.PROD ? null : (
          <LocalBriefsSection enabled={session.kind === "ready"} />
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
