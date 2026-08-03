import styles from "./PrBriefError.module.scss";
import { prBriefErrorDetail, prBriefErrorNeedsSignIn } from "./utils";

export interface PrBriefErrorProps {
  error: Error;
}

export function PrBriefError({ error }: PrBriefErrorProps) {
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={styles["errorState"]} data-testid="pr-brief-error">
        <h1>Brief failed to load</h1>
        {/* Curated copy only — never `error.message` (apps/web AGENTS.md):
            an SSR loader or server-function rejection serializes its own
            text, and even ApiError's message embeds the request path. */}
        <p>{prBriefErrorDetail(error)}</p>
        {prBriefErrorNeedsSignIn(error) ? (
          <a className="btn primary" href="/api/auth/github">
            Sign in with GitHub
          </a>
        ) : null}
      </section>
    </main>
  );
}
