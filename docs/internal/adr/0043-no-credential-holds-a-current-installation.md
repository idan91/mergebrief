# 0043: No credential holds a current installation

Status: accepted
Date: 2026-09-19

Decided on a wayfinder map (Home and
the Inbox, access-model answer page).

Every request finds its Installation from the repository it names, among the
Installations the reviewer can reach. Browser sessions and API tokens follow
the same rule. Nothing stores or switches a "current organization".

## Context

One person reaches several GitHub organizations, and Home shows one Inbox
over every Installation they can reach plus their pasted-URL pull requests.
The session row, the user settings row and the API token row each carried an
`installation_id`, and the org switcher rebound the session to one of them.
A list over several organizations cannot be served from one stored
installation, and every gated route resolved its world from that column.

## Decision

- **Resolve from the repository on every request.** After the viewer's token
  proves read access, the gate asks which reachable Installation holds the
  repository and scopes the request to it. A repository in none drops to the
  viewer's own pasted-URL rows. The reachable set and each Installation's
  repository intersection are read with the viewer's token and cached 60 s
  per credential, positives only.
- **Sessions and API tokens alike.** An API token links to the person's
  GitHub grant, and that grant reaches every organization the person can
  reach, so the token does too. The one-installation bind on tokens was our
  own limit and goes. Accepted cost: a leaked token opens every organization
  the person can reach, the same as a GitHub classic token.
- **The stored columns go unread, then go.** `auth_session.installation_id`,
  `user_settings.default_installation_id` and `api_token.installation_id`
  stop being read; a later migration drops them.

## Rejected

Switching the stored installation silently when a row from another
organization is opened. It touches almost as many routes and still needs the
multi-installation list, and it adds two failures that are hard to test: a
switch in one tab changes what another open tab sees, and a write can land
under a sign-in that changed before the save.

## Consequences

- Multi-scope reads exist for the Inbox list only; every write keeps one
  scope. `packages/persistence/AGENTS.md` carries the rule.
- The org switcher leaves the header; the Inbox installation filter does its
  visible job.
- Audit rows key on the world the request acted in, the `ctx` the gate
  resolved: the installation holding the repository, or the url-box world
  for a request that names no repository or one in no reachable
  installation.
- Uninstalling the App from an organization removes that installation's rows
  only. Sessions and API tokens stay, because neither holds an installation
  and GitHub stops confirming the access.
