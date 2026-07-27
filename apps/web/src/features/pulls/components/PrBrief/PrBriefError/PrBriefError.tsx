import { ApiError, ApiErrorKind } from "../../../../../data/apiFetch";
import styles from "./PrBriefError.module.scss";

/** Kind-keyed detail copy; unknown API kinds fall through to unreachable. */
const API_ERROR_DETAIL: Partial<Record<ApiErrorKind, string>> = {
  [ApiErrorKind.NOT_FOUND]:
    "This pull request (or this span's brief) was not found.",
  [ApiErrorKind.UNAUTHORIZED]: "You need to sign in to read this brief.",
};
const UNREACHABLE_DETAIL =
  "The MergeBrief backend is unreachable right now — try again shortly.";

export interface PrBriefErrorProps {
  error: Error;
}

export function PrBriefError({ error }: PrBriefErrorProps) {
  const detail =
    error instanceof ApiError
      ? (API_ERROR_DETAIL[error.kind] ?? UNREACHABLE_DETAIL)
      : error.message;
  return (
    <main className="main" id="main-content" tabIndex={-1}>
      <section className={styles["errorState"]}>
        <h1>Brief failed to load</h1>
        <p>{detail}</p>
        {error instanceof ApiError &&
        error.kind === ApiErrorKind.UNAUTHORIZED ? (
          <a className="btn primary" href="/api/auth/github">
            Sign in with GitHub
          </a>
        ) : null}
      </section>
    </main>
  );
}
