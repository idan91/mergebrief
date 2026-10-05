// octokit's `App` owns JWT signing and installation-token caching; nothing
// here hand-rolls either.
import { App, Octokit } from "octokit";
import type { InstallationId } from "persistence";
import type { GitHubConfig } from "../config";
import { retryOptions } from "./retry";

/** A single App-JWT authenticated client, with oauth and webhooks wired in. */
// oxlint-disable-next-line house/no-re-export -- this package is the octokit adapter; AppClient is the name api and worker use for what createAppClient returns, so neither depends on octokit
export type AppClient = App;

/** No network call: octokit defers JWT signing until a request needs it. */
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
    // Installation clients never retry a permanent status such as 406, the
    // diff-too-large answer.
    Octokit: Octokit.defaults({ retry: retryOptions() }),
  });
}

/**
 * Returns the raw promise, not a `Result`: a rejection is a network or auth
 * failure for the caller issuing the real request to handle.
 */
export function getInstallationClient(
  app: AppClient,
  installationId: InstallationId,
): Promise<Octokit> {
  return app.getInstallationOctokit(Number(installationId));
}
