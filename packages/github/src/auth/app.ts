// octokit's `App` owns JWT signing and installation-token caching; nothing
// here hand-rolls either.
import type { Octokit as CoreOctokit } from "@octokit/core";
import { App, Octokit } from "octokit";
import type { InstallationId } from "persistence";
import type { GitHubConfig } from "../config";
import { retryOptions } from "./retry";
import { createTimedFetch } from "./utils";

/** A single App-JWT authenticated client, with oauth and webhooks wired in. */
// oxlint-disable-next-line house/no-re-export -- this package is the octokit adapter; AppClient is the name api and worker use for what createAppClient returns, so neither depends on octokit
export type AppClient = App;

/**
 * The installation-token mint's own deadline, under the confirmation reads'
 * budget. auth-app shares one pending mint per installation until it settles,
 * so a mint left hanging would hold every later call on that installation.
 */
export const MINT_TIMEOUT_MS = 3_000;

interface AppClientOptions {
  /** Overrides `MINT_TIMEOUT_MS`; production leaves it unset. */
  readonly mintTimeoutMs?: number;
}

/** The mint's route, as a hook sees its template and as fetch sees its path. */
const MINT_ROUTE_PATTERN =
  /\/app\/installations\/(?:\{installation_id\}|\d+)\/access_tokens$/;

function readRequestPath(input: Parameters<typeof fetch>[0]): string {
  if (input instanceof Request) {
    return new URL(input.url).pathname;
  }
  return new URL(input).pathname;
}

/** Every request goes out as before; the token mint alone gets a deadline. */
function createMintBoundedFetch(mintTimeoutMs: number): typeof fetch {
  const timedFetch = createTimedFetch(mintTimeoutMs);
  return function fetchWithMintDeadline(input, init) {
    if (MINT_ROUTE_PATTERN.test(readRequestPath(input))) {
      return timedFetch(input, init);
    }
    return globalThis.fetch(input, init);
  };
}

/** A retried mint would outlive every caller's budget, so it is asked once. */
function askMintOnce(octokit: CoreOctokit): void {
  octokit.hook.before("request", (options) => {
    if (MINT_ROUTE_PATTERN.test(options.url)) {
      options.request = { ...options.request, retries: 0 };
    }
  });
}

/** No network call: octokit defers JWT signing until a request needs it. */
export function createAppClient(
  config: GitHubConfig,
  options: AppClientOptions = {},
): AppClient {
  const mintTimeoutMs = options.mintTimeoutMs ?? MINT_TIMEOUT_MS;
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
    Octokit: Octokit.plugin(askMintOnce).defaults({
      retry: retryOptions(),
      request: { fetch: createMintBoundedFetch(mintTimeoutMs) },
    }),
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
