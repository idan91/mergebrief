// Settings page. Session-gated like the picker's DB sections — logged-out
// viewers get the sign-in pointer, never a broken form.
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { TokenSettings } from "@web/features/tokens";
import { pullsSessionQueryOptions } from "../features/pulls/queries";
import styles from "./settings.module.scss";

export const Route = createFileRoute("/settings")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(pullsSessionQueryOptions()),
  component: SettingsPage,
});

function SettingsPage() {
  const session = useSuspenseQuery(pullsSessionQueryOptions()).data;

  return (
    <main className={styles["main"]} id="main-content" tabIndex={-1}>
      <nav aria-label="Breadcrumb" className={styles["breadcrumb"]}>
        <Link to="/">← Back to Briefs</Link>
      </nav>
      <h1>Settings</h1>
      {session.kind === "ready" ? (
        <TokenSettings enabled />
      ) : session.kind === "unavailable" ? (
        // A backend/GitHub failure is NOT proof the viewer is logged out, so
        // the copy stays recoverable rather than telling them to sign in.
        <p className={styles["signedOut"]} role="alert">
          The server is unavailable right now — your tokens are untouched.
          Refresh to retry.
        </p>
      ) : (
        <p className={styles["signedOut"]}>
          <a href="/api/auth/github">Sign in with GitHub</a> to manage API
          tokens.
        </p>
      )}
    </main>
  );
}
