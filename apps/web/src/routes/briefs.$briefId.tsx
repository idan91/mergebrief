import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { BriefPage } from "../features/brief/components/BriefPage/BriefPage";
import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import styles from "./routeShared.module.scss";

export const Route = createFileRoute("/briefs/$briefId")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        localBriefQueryOptions(params.briefId),
      ),
      context.queryClient.ensureQueryData(localBriefsQueryOptions()),
      context.queryClient.ensureQueryData(
        localRevisionChangesQueryOptions(params.briefId),
      ),
    ]),
  component: BriefRoute,
  errorComponent: BriefError,
});

function BriefRoute() {
  const { briefId } = Route.useParams();
  const artifacts = useSuspenseQuery(localBriefsQueryOptions()).data;
  return <BriefPage artifacts={artifacts} briefId={briefId} key={briefId} />;
}

function BriefError({ error }: { error: Error }) {
  return (
    <main className="main">
      <section className={styles["errorState"]}>
        <h1>Brief failed to load</h1>
        <p>{error.message}</p>
      </section>
    </main>
  );
}
