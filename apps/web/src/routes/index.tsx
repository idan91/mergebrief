import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { localBriefsQueryOptions } from "../features/brief/queries";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(localBriefsQueryOptions()),
  component: BriefPicker,
  errorComponent: BriefPickerError,
});

function BriefPicker() {
  const briefs = useSuspenseQuery(localBriefsQueryOptions()).data;

  return (
    <main className="picker-main">
      <section className="brief-picker">
        <div className="wordmark picker-wordmark">
          Brief<span> / review</span>
        </div>
        <div className="eyebrow">Local categorizer output</div>
        <h1>Choose a PR brief</h1>
        <p className="picker-copy">Each generated output in tools/categorizer/out gets its own route and cache key.</p>
        {briefs.length === 0 ? (
          <div className="empty picker-empty">No local brief outputs found.</div>
        ) : (
          <div className="brief-list">
            {briefs.map((brief) => (
              <Link className="brief-link" key={brief.id} params={{ briefId: brief.id }} to="/briefs/$briefId">
                <span className="brief-link-title">{brief.title}</span>
                <span className="brief-link-meta">
                  {brief.repo} #{brief.number} · {brief.id} · {brief.sha.slice(0, 7)}
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
