# BRIEF-40 research: GitHub App user-to-server token grant semantics

Primary-source research against docs.github.com only. Retrieved 2026-07-23.
Context: token-refresh divergence — a minted API token copies the browser
session's GitHub token pair; refresh tokens are single-use, so whichever
channel refreshes first strands the other. Mitigation options under
evaluation: (a) cross-patch the two DB rows sharing one grant, (b) give the
CLI token its own grant via a second authorization.

## TL;DR

1. **Grant coexistence — DOCS SILENT (with supporting evidence for
   coexistence).** No GitHub docs page states what happens to an earlier
   user access token / refresh token when the same user authorizes the same
   GitHub App again. No per-user-per-app token limit is documented for
   GitHub Apps. The historical ten-token limit is documented under a heading
   explicitly scoped to "an OAuth app with the same scope", and GitHub App
   user access tokens "do not use scopes", so that rule does not cleanly
   apply. Circumstantial doc evidence (older tokens surviving the
   expiration opt-in) suggests multiple outstanding tokens per user do
   coexist, but this is inference, not a documented guarantee — verify
   empirically before betting the design on it.
2. **Device flow for GitHub Apps — CONFIRMED.** Requires the "Enable
   Device Flow" setting in the App's settings; device-flow tokens get the
   same `refresh_token` / `refresh_token_expires_in` as web-flow tokens.
   Codes expire after 900 s default; polling is throttled via `interval`;
   50 verification-code submissions/hour/app. **The App manifest has NO
   parameter for device flow** (nor for token expiration) — self-hosters
   creating Apps from a manifest must flip the toggle manually afterwards.
3. **Refresh rotation — CONFIRMED.** 8-hour user access token, 6-month
   refresh token, refresh token single-use ("Once you use a refresh token,
   that refresh token and the old user access token will no longer work.").
   Error shape when replaying a consumed refresh token: DOCS SILENT.
   Expiration is still an opt-in per-App setting ("Expire user
   authorization tokens"), described as "currently an optional feature and
   ... subject to change".
4. **Re-authorization / revocation effects — PARTIAL.** User revokes the
   authorization → "any tokens associated with the authorization will be
   revoked as well" (CONFIRMED), and the app receives the mandatory
   `github_app_authorization` webhook. Effect of *re*-authorization on
   outstanding tokens: DOCS SILENT. Effect of uninstalling on user tokens:
   DOCS SILENT (docs only say install and authorization are independent).
   REST: `DELETE /applications/{client_id}/token` revokes a single token;
   `DELETE /applications/{client_id}/grant` deletes the grant and "all
   OAuth tokens associated with the application for the user" (CONFIRMED,
   both endpoints apply to GitHub Apps).
5. **Other load-bearing facts — CONFIRMED.** No API exists to list a
   user's tokens for an app. Per-token revocation granularity exists
   (delete-token vs delete-grant). `POST /applications/{client_id}/token`
   (check) and `PATCH` (reset) work for GitHub Apps without user
   involvement. Revoked-token use returns `401 Bad Credentials`.

---

## 1. Grant coexistence (the pivotal question)

**Verdict: DOCS SILENT on revoke-vs-coexist for GitHub Apps; no documented
per-user token limit for GitHub Apps.**

Pages checked for an explicit statement, all silent on re-authorization's
effect on prior tokens:

- "Generating a user access token for a GitHub App"
  (<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>)
  — describes web application flow and device flow; nothing about prior
  tokens being revoked on a new authorization, and no token-count limit.
- "Refreshing user access tokens"
  (<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens>)
  — "If your refresh token expires before you use it, you can regenerate a
  user access token and refresh token by sending users through the web
  application flow or device flow." Re-authorization is presented as the
  recovery path with no caveat about it invalidating anything else.
- "About authentication with a GitHub App"
  (<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app>)
  — does not address token coexistence, limits, or re-authorization.
- "Authorizing GitHub Apps"
  (<https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps>)
  — user-facing; does not address multiple authorizations.
- "Token expiration and revocation"
  (<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation>)
  — enumerates every documented revocation trigger (full heading list:
  expiration date, pushed to public repo/gist, lack of use, revoked by
  user, revoked by third party, revoked by the OAuth app, excess tokens
  for an OAuth app with the same scope, GitHub App configuration, revoked
  by enterprise owners). **"New authorization by the same user" is not
  among the documented triggers.**

### The ten-token limit is documented for OAuth Apps only

The limit lives under a heading that scopes itself:

> "Token revoked due to excess of tokens for an OAuth app with the same
> scope — There is a limit of ten tokens that are issued per
> user/application/scope combination, and a rate limit of ten tokens
> created per hour. If an application creates more than ten tokens for the
> same user and the same scopes, the oldest tokens with the same
> user/application/scope combination are revoked. However, hitting the
> hourly rate limit will not revoke your oldest token. Instead, it will
> trigger a re-authorization prompt within the browser..."
> — <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation>

The same text appears in "Authorizing OAuth apps"
(<https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>).
Neither occurrence mentions GitHub Apps. And GitHub App user access tokens
are defined as scope-less:

> "A user access token is a type of OAuth token. Unlike a traditional
> OAuth token, the user access token does not use scopes. Instead, it uses
> fine-grained permissions."
> — <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>

So the documented limit keys on a "user/application/scope combination"
that GitHub App tokens do not have. Whether GitHub applies an analogous
internal limit to GitHub Apps is **not documented anywhere found**.

### Circumstantial evidence that multiple tokens coexist

From "Refreshing user access tokens":

> "If you opt into user access tokens that expire after you have already
> generated user access tokens, the previously generated user access
> tokens will not expire. You can delete these tokens by using the
> `DELETE /applications/CLIENT_ID/token` endpoint."
> — <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens>

This passage presumes several outstanding user access tokens for one user
can exist simultaneously and remain valid (they must be cleaned up
one-by-one via the delete-token endpoint). It is evidence *against* a
"one live token per user per app, newest kills oldest" model — but it is
inference from an adjacent scenario (config migration), not a stated
guarantee about re-authorization. **Recommendation: settle this with a
live experiment (authorize twice, confirm both token pairs refresh
independently) before locking option (b).**

## 2. Device flow for GitHub Apps

**Verdict: CONFIRMED, with one important manifest gap.**

- Setting: it must be enabled per App. Exact setting name from
  "Registering a GitHub App": **"Enable Device Flow"** — "allows you to
  use device flow to generate a user access token."
  (<https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app>)
  The GitHub Apps token doc repeats the prerequisite: "Before you can use
  the device flow, you must first enable it in your app's settings."
  (<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>)
- Constraints (from the device-flow documentation shared across the
  GitHub Apps and OAuth Apps token docs):
  - `expires_in`: "The number of seconds before the `device_code` and
    `user_code` expire. The default is 900 seconds or 15 minutes."
  - `interval`: "The minimum number of seconds that must pass before you
    can make a new access token request." Docs warn: "Do not poll this
    endpoint at a higher frequency than the frequency indicated by
    `interval`" (violations return `slow_down`).
  - "When a user submits the verification code on the browser, there is a
    rate limit of 50 submissions in an hour per application."
  - Error codes: `authorization_pending`, `slow_down`, `expired_token`,
    `unsupported_grant_type`, `incorrect_client_credentials`,
    `incorrect_device_code`, `access_denied`, `device_flow_disabled`.
  - Sources:
    <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps>,
    <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>
- Refresh parity: the device-flow access-token response documented for
  GitHub Apps includes `access_token`, `expires_in`, `refresh_token`,
  `refresh_token_expires_in`, `scope`, `token_type` — same shape as the
  web application flow, so device-flow tokens expire and refresh
  identically.
  (<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app>)
- **Manifest gap (CONFIRMED ABSENT):** the App manifest parameter list
  (`name`, `url`, `hook_attributes`, `redirect_url`, `callback_urls`,
  `setup_url`, `description`, `public`, `default_events`,
  `default_permissions`, `request_oauth_on_install`, `setup_on_update`)
  contains **no parameter for device flow and none for user token
  expiration**.
  (<https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest>)
  Consequence for self-hosters creating their App from our manifest: if
  the CLI relies on device flow, every self-hoster must manually tick
  "Enable Device Flow" in the App settings after creation — a documented
  setup step and a support-surface cost.

## 3. Refresh rotation semantics

**Verdict: CONFIRMED on lifetimes and single-use; DOCS SILENT on error
shape.**

All from "Refreshing user access tokens"
(<https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens>)
unless noted:

- Lifetimes: "The user access token expires after eight hours" and "the
  refresh token expires after six months." The generating doc phrases the
  first as "By default, the user access token expires after 8 hours."
- Single-use rotation: "Once you use a refresh token, that refresh token
  and the old user access token will no longer work." A successful refresh
  returns a new `refresh_token` (with `refresh_token_expires_in` =
  `15897600`, "6 months").
- Replaying a consumed/expired refresh token: **docs do not specify the
  error shape.** The docs only say that if the refresh token expires the
  recovery is a fresh web/device flow. Do not code against an assumed
  error body — handle any failure of the refresh exchange as
  "grant needs re-authorization".
- Opt-in status: expiration is still a per-App toggle, not mandatory.
  Setting name: **"Expire user authorization tokens"** (Registering a
  GitHub App,
  <https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app>).
  "User access tokens that expire are currently an optional feature and
  are subject to change" (generating doc); "GitHub recommends that you opt
  in to this feature for improved security" (refreshing doc). "Token
  expiration and revocation" adds: "Owners of GitHub Apps can optionally
  configure these tokens to never expire instead, but this is not
  recommended due to the security implications."

## 4. Re-authorization / revocation / uninstall effects on outstanding tokens

- **User revokes the app authorization — CONFIRMED, kills everything under
  the grant:** "You can revoke your authorization of a GitHub App or OAuth
  app from your account settings which will revoke any tokens associated
  with the app. Once an authorization is revoked, any tokens associated
  with the authorization will be revoked as well."
  (<https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation>)
  The app is notified: "when a user revokes their authorization of a
  GitHub App" the `github_app_authorization` webhook fires; "A GitHub App
  receives this webhook by default and cannot unsubscribe from this
  event." Continued use yields "the `401 Bad Credentials` error."
  (<https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization>)
- **User re-authorizes the app — DOCS SILENT.** No page found states any
  effect of a repeat authorization on outstanding tokens (see section 1).
- **App uninstalled from an org/user — DOCS SILENT on user tokens.** Docs
  only establish that installation and authorization are independent:
  "You can install a GitHub App without authorizing the app. Similarly,
  you can authorize the app without installing the app."
  (<https://docs.github.com/en/apps/using-github-apps/authorizing-github-apps>)
  No documented revocation trigger ties user access tokens to
  uninstallation. (Note the user-token *permission intersection* — "A user
  access token only has permissions that both the user and the app have" —
  means uninstall can still gut what the token can reach without revoking
  it; docs do not spell this out for the uninstall case specifically.)
- **REST revocation granularity — CONFIRMED, per-token and per-grant both
  exist** ("OAuth apps" REST reference,
  <https://docs.github.com/en/rest/apps/oauth-applications?apiVersion=2022-11-28>):
  - Delete an app token (`DELETE /applications/{client_id}/token`): "OAuth
    or GitHub application owners can revoke a single token for an OAuth
    application or a GitHub application with an OAuth authorization."
  - Delete an app authorization (`DELETE /applications/{client_id}/grant`):
    "revoke a grant for their application and a specific user. ... Deleting
    an application's grant will also delete all OAuth tokens associated
    with the application for the user. Once deleted, the application will
    have no access to the user's account..."
  - Both endpoints authenticate with the app's client ID/secret (Basic)
    and take an `access_token` in the body — they explicitly cover GitHub
    Apps ("GitHub applications with OAuth authorizations").

## 5. Other load-bearing findings

- **No token-listing API.** The OAuth-applications REST page exposes only
  check / reset / delete-token / delete-grant; no endpoint enumerates a
  user's outstanding tokens for an app. The app cannot discover how many
  token pairs a user has — it can only track what it minted.
  (<https://docs.github.com/en/rest/apps/oauth-applications?apiVersion=2022-11-28>)
- **Check a token** (`POST /applications/{client_id}/token`): "checking
  OAuth token validity without exceeding the normal rate limits for failed
  login attempts" — usable as a cheap liveness probe for a stored token.
- **Reset a token** (`PATCH /applications/{client_id}/token`): "reset a
  valid OAuth token without end-user involvement. Applications must save
  the 'token' property in the response because changes take effect
  immediately." A server-side rotation primitive that does not require the
  user in the loop — but docs do not state how it interacts with the
  refresh-token pair of an expiring GitHub App user token (silent).
- **Revocation webhook is per-grant, not per-token.** The
  `github_app_authorization` event fires on authorization revocation; docs
  describe no event for a single token being deleted/expired. So under a
  shared grant, one revocation event means both DB rows are dead; under
  two grants... docs do not describe grant-scoped payload detail
  sufficient to distinguish which authorization died (the payload carries
  the user/sender, not a token identifier).
  (<https://docs.github.com/en/webhooks/webhook-events-and-payloads#github_app_authorization>)

## Implications for BRIEF-40

**Option (a): cross-patch two DB rows sharing one grant's token pair.**

- Fully supported by documented semantics: single-use rotation is the only
  hazard, and it is entirely ours to serialize ("Once you use a refresh
  token, that refresh token and the old user access token will no longer
  work"). Requires a single-writer refresh path (row lock / advisory lock)
  so browser and CLI never race the exchange, and both rows updated
  atomically with the new pair.
- Revocation blast radius is honest: the two rows genuinely are one grant,
  and `github_app_authorization` / "revoke authorization revokes all
  associated tokens" means one webhook correctly kills both rows.
- No GitHub-side unknowns: nothing in this option depends on undocumented
  behavior.

**Option (b): second authorization so the CLI token owns its own grant.**

- Rests on the coexistence question, which is **not documented**. The
  circumstantial evidence (pre-opt-in tokens surviving alongside new ones;
  ten-token rule scoped to OAuth-app scopes) leans toward independent
  token pairs, but an empirical two-authorization test is mandatory before
  committing. If GitHub in fact invalidates the prior pair on
  re-authorization, option (b) silently recreates the exact divergence bug
  it is meant to fix — worst possible failure mode.
- Device flow is the natural second-authorization UX for a CLI and is
  refresh-parity confirmed, but it adds a manual "Enable Device Flow"
  checkbox to every self-hoster's App setup (not settable via manifest).
  A second web-flow authorization avoids that but needs a browser hop.
- Revocation semantics get murkier, not cleaner: the docs describe
  revocation and the `github_app_authorization` webhook at
  user-authorization granularity, and the payload does not identify which
  token/grant was revoked — with two grants per user we may not be able to
  tell which row to kill (docs silent). Also no listing API to reconcile.
- Note: even under one grant, per-token deletion granularity exists
  (`DELETE /applications/{client_id}/token`), so option (a) can still
  revoke the CLI token alone if it stores its own token pair after an
  initial copy — but a copied pair is the same pair; only a pair minted by
  its own code-exchange or refresh is independently deletable.

**Net:** documented semantics fully cover option (a) and leave option (b)'s
central premise unverified. If (b) stays on the table, run the
two-authorization coexistence experiment first; otherwise (a) with a
serialized refresh (single-writer) is the option with zero undocumented
dependencies.

---

*All quotes retrieved from docs.github.com on 2026-07-23.*
