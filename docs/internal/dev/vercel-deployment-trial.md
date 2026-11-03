# Vercel deployment trial

Verified against provider documentation on 2026-11-01. This is an experimental
integration guide, not a tested deployment or a supported alternative to
Compose. It does not deploy anything or add executable Vercel configuration
to the repository. Use a dedicated test project, database and GitHub App.

Vercel now documents container HTTP Services and continuous Daemons. The
proposed layout is two HTTP services (web and API), one worker daemon, and
external Postgres. Vercel does not run the Compose file. The database cannot
live on the daemon filesystem.

## 1. Decide whether this test fits

Use this track to evaluate Vercel compatibility. For a first complete
self-host trial with the existing supported packaging, use
[Hetzner or EC2](../../self-host/cloud-deployment.md).

Before deploying, account for these differences:

- HTTP containers can scale to zero. API timers cannot be assumed to run
  continuously, and autoscaling/rolling overlap multiplies DB pools.
- Daemons currently run only in production deployments. A preview URL
  alone cannot exercise the full generation flow. Use a separate Vercel
  project whose production environment is exclusively this experiment.
- The current project-environment model can expose secrets to web too.
  Compose intentionally keeps credentials out of web. Resolve environment
  isolation before claiming equivalent security; use disposable trial
  credentials while evaluating it.
- Function payload/time limits can restrict the app's media and attachment
  flows. Test those explicitly; successful page rendering is insufficient.
- Custom containers currently lack Static IPs/Secure Compute support. Do
  not assume private RDS access or a fixed source IP for DB allowlisting.
  If your DB policy requires either, use a VM until compatible networking
  is available and verified.

Sources and exact limits are collected in
[the research notes below](#vercel-services-and-daemons).

## 2. Prepare the database and identity

1. Create a dedicated Neon project with a direct PostgreSQL endpoint in a
   region near the Vercel region. Supabase direct access is an alternative
   only after checking outbound IP-family compatibility. Avoid transaction
   poolers for the worker.
2. Create an isolated database and login with migration permissions.
3. Store a direct DSN using `sslmode=verify-full` in Vercel's production
   environment as DATABASE_URL. Do not use a public/client variable prefix.
   Do not commit it or put it in vercel.json.
4. If a provider requires a private CA, arrange a readable CA file in both
   API and worker images and reference it through sslrootcert. A CA
   certificate is public; the DSN is secret. The existing Dockerfile does
   not automatically include a new certificate file. Never disable TLS
   verification to avoid this packaging step.
5. Register a dedicated GitHub App following [github-app.md](../../self-host/github-app.md).
   Use a stable domain such as `brief-vercel.example.com` for the homepage,
   OAuth callback and webhook. Keep the webhook inactive until boot works.

## 3. Prepare a configuration in a trial branch

Import the repository into a new Vercel project. Keep the project root at
the repository root; the shared workspace Dockerfile needs all packages.
Select the intended source commit and record it. Avoid deploying changing
main commits while comparing test results.

The following vercel.json candidate follows the documented configuration
shape. It still needs validation against the platform and this image:

```json
{
  "services": {
    "web": {
      "root": ".",
      "runtime": "container",
      "entrypoint": "Dockerfile",
      "command": ["web"],
      "bindings": [
        {
          "type": "service",
          "service": "api",
          "format": "url",
          "env": "MERGEBRIEF_API_ORIGIN"
        }
      ]
    },
    "api": {
      "root": ".",
      "runtime": "container",
      "entrypoint": "Dockerfile",
      "command": ["api"]
    }
  },
  "rewrites": [
    { "source": "/(.*)", "destination": { "service": "web" } }
  ],
  "daemons": {
    "worker": {
      "root": ".",
      "entrypoint": "Dockerfile",
      "command": ["/usr/local/bin/docker-entrypoint.sh", "worker"],
      "instances": { "iad1": 1 }
    }
  }
}
```

Replace `iad1` with a supported region near the database if appropriate.
Service command overrides CMD, so it passes `web`/`api` to the existing
ENTRYPOINT. Daemon command replaces ENTRYPOINT and CMD, so it needs the full
executable. Do not replace that command with the bare word `worker`.
The service binding provides the API URL; do not hard-code Compose's
`http://api:3001`. Only web has a public rewrite, preserving the existing
web proxy and `/api` paths.

See the official [service configuration](https://vercel.com/docs/services/config-reference),
[bindings](https://vercel.com/docs/services/bindings), and
[daemon configuration](https://vercel.com/docs/daemons/config-reference).
Do not add an HTTP health probe to the current worker: it has no listener.

## 4. Set production environment variables

Use the dashboard's environment-variable controls; enter real secrets
there rather than using command-line arguments. Set:

| Variable | Value / source |
| --- | --- |
| PUBLIC_BASE_URL | `https://brief-vercel.example.com` |
| PORT | `3000` |
| MERGEBRIEF_WEB_PORT | `3000` |
| MERGEBRIEF_WEB_HOST | `0.0.0.0` |
| MERGEBRIEF_API_PORT | `3000` |
| MERGEBRIEF_API_HOST | `0.0.0.0` |
| DATABASE_URL | Direct verified-TLS DSN |
| DATABASE_POOL_MAX | Start with `3`; reserve extra connections for scaling |
| MERGEBRIEF_AUTO_MIGRATE | `true` for a new isolated trial DB |
| GITHUB_APP_ID | Dedicated test App ID |
| GITHUB_APP_PRIVATE_KEY | Complete PEM with actual newlines |
| GITHUB_WEBHOOK_SECRET | Dedicated random secret |
| GITHUB_OAUTH_CLIENT_ID | Test App OAuth client ID |
| GITHUB_OAUTH_CLIENT_SECRET | Test App OAuth client secret |
| SESSION_KEY_V1 | Dedicated random 32-byte base64 key |
| ANTHROPIC_API_KEY | Model provider API key for default configuration |

Leave DATABASE_URL_FILE and GITHUB_APP_PRIVATE_KEY_PATH unset unless you
have implemented their file delivery. Leave MERGEBRIEF_API_ORIGIN to the
binding. Do not upload a Compose .env file as a source asset.
The two HTTP services can use the same port because they run separately.
Both the platform PORT and the app-specific variables must agree.
Vercel also passes these variables to the image build as build arguments. The
Dockerfile declares none of them, so never add an `ARG` named after a secret.
On Hobby a 2 GiB daemon, the default, reaches the 420 GB-hour quota in about 9
days and a 1 GiB one in about 17; Vercel then stops it until next month.

If using another generator or a custom cap, package an instance YAML at a
known path and set MERGEBRIEF_CONFIG. The existing image excludes your local
config; setting a path without adding the file causes boot failure.
Keep API keys in environment variables referenced by YAML, not in YAML.

## 5. Deploy and validate

Use the Vercel dashboard to deploy the trial branch/commit as this dedicated
project's production deployment. Confirm the image builds for linux/amd64,
commands are accepted and the API binding resolves. If Vercel rejects the
configuration or build context, treat that as an integration task rather
than removing runtime safeguards to force a green deployment.

Attach the stable domain and set PUBLIC_BASE_URL to it before testing OAuth.
Check that deployment protection does not block GitHub's webhook. Verify:

1. Public `/healthz` and `/readyz` succeed, and the signed-out page renders.
2. Service logs show the expected ports; worker logs show successful startup
   and it remains running. Daemons restart even on successful exit, unlike
   Compose, so fix repeated configuration failures rather than ignoring them.
3. Login succeeds on the stable hostname and cookies persist. Internal
   service routing preserves the Host/Origin assumptions used by the app.
4. Activate the webhook and run the complete PR/generation/review checklist
   in [the VM guide](../../self-host/cloud-deployment.md#6-verify-the-trial-before-calling-it-successful).
5. Let HTTP services idle, then repeat login and generation. Confirm cold
   starts and API periodic tasks do not break expected behavior.
6. Test attachments and media near the app's configured bounds, plus long
   review submissions. Compare actual platform rejection limits with the
   app's expectations before calling this deployment feature-complete.
7. Redeploy during a generation. Confirm job recovery, migration safety,
   database connection capacity during old/new overlap and shutdown behavior.
8. Check daemon CPU/memory quotas and billing. An idle worker still consumes
   provisioned memory; Hobby limits can stop it before a month has elapsed.

The default HTTP termination window differs from the Compose web service's
160-second grace period. Test interrupted long requests. Keep one daemon
instance for this first experiment and avoid unbounded API autoscaling
against a tiny database.

## 6. Promote or retire the experiment

Promote this to a supported recipe only after documenting the verified
configuration, environment isolation, payload limits, cold-start behavior,
worker recovery and backup restore. Until then it is a platform feasibility
trial. A hybrid Vercel frontend plus VM backend also requires routing and
authentication integration; it is not automatically simpler.

To stop the trial, disable the GitHub webhook, stop/remove its daemon and
project, then remove the external database only after preserving needed
data. Revoke dedicated credentials. Deleting a Vercel project does not
necessarily delete an independently provisioned database.

## Vercel Services and Daemons

Current Vercel docs describe both container HTTP Services and continuous Daemons in beta on all plans. A blanket claim that Vercel cannot run containers or workers is obsolete. Vercel does not consume Compose; the three processes need explicit configuration and external PostgreSQL. Sources: [Services](https://vercel.com/docs/services), [Daemons](https://vercel.com/docs/daemons), [Compose mapping](https://vercel.com/i/can-you-run-docker-compose-on-vercel).

### Configuration candidate, not a validated recipe

The candidate `vercel.json` is in section 3 above.

Service `command` overrides Docker `CMD`; daemon `command` replaces **both** `ENTRYPOINT` and `CMD`, hence the full executable above. Daemons require `root`, Dockerfile-relative `entrypoint`, and regional `instances`; they reject `runtime`, `framework`, and `buildCommand`. The Dockerfile's directory is the daemon build context. Sources: [service configuration](https://vercel.com/docs/services/config-reference), [daemon configuration](https://vercel.com/docs/daemons/config-reference).

The caller binding injects `MERGEBRIEF_API_ORIGIN`; do not supply Compose's `http://api:3001`. Only web needs a public rewrite, preserving its existing API proxy. Bindings work at runtime, not build time. Source: [service bindings](https://vercel.com/docs/services/bindings).

Set project `PORT=3000`, `MERGEBRIEF_WEB_PORT=3000`, `MERGEBRIEF_API_PORT=3000`, and both host variables to `0.0.0.0`: separate containers can share a port, and MergeBrief's own port variables must agree with Vercel's router. Supply the documented app environment and HTTPS `PUBLIC_BASE_URL`. Vercel otherwise expects port 80. HTTP containers scale down after five idle minutes in production, 30 seconds in preview, with 30 seconds after SIGTERM. API periodic work therefore cannot assume continuous uptime. Source: [container runtime](https://vercel.com/docs/functions/runtimes/container).

### Limits that affect this proposal

- Daemons: production only; no inbound application traffic, persistent storage, autoscaling, or `vercel dev` execution. Project root cannot be a subfolder. Linux amd64; memory choices 1/2/4/8 GiB with 1/1/2/4 vCPUs. Default shutdown grace 30 seconds, configurable to 3,600. At most 100 daemons/project, 100 instances/daemon/region, and a default effective cap of 50 instances/project environment. Pro defaults to 16 vCPUs and 32 GiB/team. Hobby allows only 1/2 GiB instances and 5 CPU-hours plus 420 GB-hours/month; either exhaustion stops daemons. An always-on worker therefore needs a paid capacity assessment. Source: [daemon limits](https://vercel.com/docs/daemons/limits).
- Daemons restart even after a successful exit, unlike Compose's `on-failure` policy. Do not add an HTTP liveness probe to the current worker without implementing a listener. Sources: [daemon lifecycle and probes](https://vercel.com/docs/daemons).
- Services inherit Function limits. Published limits include 4.5 MB request/response payloads, 2 GB Hobby / 4 GB paid maximum memory, and bounded request duration. These need reconciling with MergeBrief attachments/media. The documented 1,800-second extended duration and 5 GB large-function beta name specific language runtimes; do not assume they apply to custom containers. Sources: [Services limits](https://vercel.com/docs/services/pricing), [Function limits](https://vercel.com/docs/functions/limitations).
- Custom containers currently lack Secure Compute and Static IPs: do not present the private EC2/RDS networking recipe as directly reusable on Vercel. Images also face VCR limits: 2 GB/compressed layer, 15 GB total compressed image, and two million filesystem entries during optimization. Sources: [container restrictions](https://vercel.com/docs/functions/runtimes/container), [registry limits](https://vercel.com/docs/container-registry/limits-and-pricing).

## Unresolved before calling this tested

1. Validate Vercel's shared-root build, image optimization, service commands, binding URL/path handling, Host/Origin checks, OAuth cookies, webhook body signatures, and attachment size behavior. Confirm environment isolation: Services share project environment, whereas Compose deliberately withholds secrets from web.
2. Check API timers under scale-to-zero, pool exhaustion under HTTP autoscaling, and production-only daemon testing strategy.
3. Confirm effective container request/image limits and paid quotas with Vercel before publishing an operational recipe. No source reviewed proves this exact MergeBrief image has been deployed there successfully.
