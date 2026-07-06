import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { generateBrief } from "../features/brief/brief.functions";
import { localBriefsQueryOptions } from "../features/brief/queries";
import { OrgSwitcher } from "../features/installations/components/OrgSwitcher";
import { PullsSection } from "../features/pulls/components/PullsSection";
import { pullsSessionQueryOptions } from "../features/pulls/queries";
import sharedStyles from "./routeShared.module.scss";
import styles from "./index.module.scss";

export const Route = createFileRoute("/")({
  // Both lists prefetch in parallel — the session list SSRs through the
  // in-process apiFetch seam (same authz gate), never a client waterfall.
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(localBriefsQueryOptions()),
      context.queryClient.ensureQueryData(pullsSessionQueryOptions()),
    ]),
  component: BriefPicker,
  errorComponent: BriefPickerError,
});

function BriefPicker() {
  const briefs = useSuspenseQuery(localBriefsQueryOptions()).data;
  const session = useSuspenseQuery(pullsSessionQueryOptions()).data;
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const briefId = await generateBrief({ data: { url } });
      await navigate({ to: "/briefs/$briefId", params: { briefId } });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong generating this brief.",
      );
      setPending(false);
    }
  }

  return (
    <main className={styles["pickerMain"]} id="main-content" tabIndex={-1}>
      <section className={styles["picker"]}>
        <div className={styles["wordmark"]}>
          Brief<span> / review</span>
        </div>
        <div className={styles["eyebrow"]}>
          Open-source · self-hosted · BYOK
        </div>
        <h1>Turn a PR into a Brief</h1>
        <p className={styles["copy"]}>
          A Brief re-unitizes a pull request into Change-groups, each with a
          plain-language summary, a Playbook of the known checks for that kind
          of change, and Risk Surface attributes: facts worth a closer look,
          never a verdict.
        </p>
        <ul className={styles["pillars"]}>
          <li>Stable taxonomy, queryable across every PR you review</li>
          <li>Your model key, your infrastructure, nothing phones home</li>
          <li>Plain-markdown Playbooks you can read, fork, and extend</li>
        </ul>
        <form className={styles["form"]} onSubmit={handleGenerate}>
          <input
            aria-label="GitHub PR URL"
            disabled={pending}
            placeholder="https://github.com/owner/repo/pull/123"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button className="btn primary" disabled={pending} type="submit">
            {pending ? "Generating…" : "Generate"}
          </button>
        </form>
        {error ? <p className={styles["error"]}>{error}</p> : null}
        <OrgSwitcher enabled={session.kind === "ready"} />
        <PullsSection session={session} />
        {briefs.length === 0 ? (
          <div className={styles["empty"]}>
            <p>No Briefs yet. Paste a GitHub PR URL above to generate one.</p>
            <p>
              Working from the CLI instead? Run{" "}
              <code>pnpm categorize &lt;pr-url&gt;</code> from the repo root;
              outputs land here automatically.
            </p>
          </div>
        ) : (
          <div className={styles["list"]}>
            <div className={styles["listLabel"]}>Local Briefs</div>
            {briefs.map((brief) => (
              <Link
                className={styles["link"]}
                key={brief.id}
                params={{ briefId: brief.id }}
                to="/briefs/$briefId"
              >
                <span className={styles["linkTitle"]}>
                  <span
                    className={styles["artifactPill"]}
                    data-kind={brief.artifactKind}
                  >
                    {brief.artifactKind === "delta" ? "delta" : "brief"}
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
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function BriefPickerError({ error }: { error: Error }) {
  return (
    <main className="main">
      <section className={sharedStyles["errorState"]}>
        <h1>Brief list failed to load</h1>
        <p>{error.message}</p>
      </section>
    </main>
  );
}
