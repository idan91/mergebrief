// GitHub App authentication: App-JWT client construction and
// installation-scoped Octokit minting. octokit's `App` class owns JWT signing
// and installation-token minting/caching — this module never hand-rolls either.
import { App, Octokit } from "octokit";
import type { InstallationId } from "persistence";
import type { GitHubConfig } from "../config";
import { retryOptions } from "./retry";

/** A single App-JWT authenticated client, with oauth and webhooks wired in. */
export type AppClient = App;

/**
 * Construct the App-JWT authenticated client. No network call — octokit defers
 * JWT signing until a request needs it.
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
    // statuses — notably 406 (diff too large).
    Octokit: Octokit.defaults({ retry: retryOptions() }),
  });
}

/**
 * Mint an installation-scoped `Octokit`. The branded id (a type-only import
 * from `persistence`, this package's sole exception to "no DB imports") is
 * converted to a plain number here, all octokit accepts.
 *
 * Returns the raw promise, not a `Result`: a rejection here is a genuine
 * network/auth failure, handled by the callers that issue real requests.
 */
export function getInstallationClient(
  app: AppClient,
  installationId: InstallationId,
): Promise<Octokit> {
  return app.getInstallationOctokit(Number(installationId));
}
