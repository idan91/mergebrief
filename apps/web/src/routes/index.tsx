import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { generateBrief } from "../features/brief/brief.functions";
import { localBriefsQueryOptions } from "../features/brief/queries";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(localBriefsQueryOptions()),
  component: BriefPicker,
  errorComponent: BriefPickerError,
});

function BriefPicker() {
  const briefs = useSuspenseQuery(localBriefsQueryOptions()).data;
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
    <main className="picker-main">
      <section className="brief-picker">
        <div className="wordmark picker-wordmark">
          Brief<span> / review</span>
        </div>
        <div className="eyebrow">Local categorizer output</div>
        <h1>Choose a PR brief</h1>
        <p className="picker-copy">
          Each generated output in tools/categorizer/out gets its own route and
          cache key.
        </p>
        <form className="generate-form" onSubmit={handleGenerate}>
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
        {error ? <p className="generate-error">{error}</p> : null}
        {briefs.length === 0 ? (
          <div className="empty picker-empty">
            No local brief outputs found.
          </div>
        ) : (
          <div className="brief-list">
            {briefs.map((brief) => (
              <Link
                className="brief-link"
                key={brief.id}
                params={{ briefId: brief.id }}
                to="/briefs/$briefId"
              >
                <span className="brief-link-title">
                  <span className={`artifact-pill ${brief.artifactKind}`}>
                    {brief.artifactKind === "delta" ? "delta" : "brief"}
                  </span>
                  {brief.title}
                </span>
                <span className="brief-link-meta">
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
      <section className="error-state">
        <h1>Brief list failed to load</h1>
        <p>{error.message}</p>
      </section>
    </main>
  );
}
