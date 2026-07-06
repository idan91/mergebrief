// GitHub App authentication (BRIEF-2 stage 1): App-JWT client construction
// and installation-scoped Octokit minting. Built entirely on octokit's `App`
// class, which owns JWT signing and installation-token minting/caching
// internally — this module never hand-rolls either.
import { App, Octokit } from "octokit";
import type { InstallationId } from "persistence";
import type { GitHubConfig } from "./config";
import { retryOptions } from "./retry";

/**
 * A single App-JWT authenticated client, built from `GitHubConfig`. `oauth`
 * and `webhooks` are wired into the underlying `App` at construction time so
 * the one instance is reusable by later stages (webhook HMAC verify, OAuth
 * routes) without re-authenticating — but this stage's public surface only
 * exposes `getInstallationClient` over it.
 */
export type AppClient = App;

/**
 * Construct the App-JWT authenticated client from parsed config. Synchronous
 * and does not perform a network call — octokit defers JWT signing until a
 * request actually needs it.
 */
export function createAppClient(config: GitHubConfig): AppClient {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    oauth: {
      clientId: config.oauthClientId,
      clientSecret: config.oauthClientSecret,
    },
    webhooks: {
      secret: config.webhookSecret,
    },
    // Every installation client minted by this App skips retrying permanent
    // statuses — notably 406 (diff too large; see `retry.ts`).
    Octokit: Octokit.defaults({ retry: retryOptions() }),
  });
}

/**
 * Mint an installation-scoped `Octokit` for `installationId`. `installationId`
 * is the branded id (type-only import from `persistence`, this package's
 * sole exception to "no DB imports") and is converted to a plain number at
 * this boundary, which is all octokit's API accepts.
 *
 * Returns the underlying `Promise<Octokit>` as-is rather than a `Result`:
 * there is no synchronous, "expected" failure mode here (bad config is
 * already handled upstream by `loadConfig`). `getInstallationOctokit` talks
 * to GitHub to mint/cache the installation token, so its rejection is a
 * genuine network/auth failure — handling (retry, mapping to a domain
 * `Result`) belongs with the stage-2+ callers that issue real requests, not
 * this construction step.
 */
export function getInstallationClient(
  app: AppClient,
  installationId: InstallationId,
): Promise<Octokit> {
  return app.getInstallationOctokit(Number(installationId));
}
