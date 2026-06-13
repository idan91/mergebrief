import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";

import { localBriefQueryOptions } from "../features/brief/queries";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(localBriefQueryOptions()),
  component: BriefApp,
});

export function BriefApp() {
  const brief = useSuspenseQuery(localBriefQueryOptions()).data;

  return (
    <main className="app-shell">
      <p>
        {brief.pr.repo} #{brief.pr.number} · {brief.pr.title}
      </p>
    </main>
  );
}
