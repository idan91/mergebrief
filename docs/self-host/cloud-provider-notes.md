# Cloud provider research notes

Verified against official documentation on **2026-11-01**. Documentation research only: no provider deployment or integration test was performed. Feasibility below is an inference from provider contracts and the local image, not a tested deployment claim.

## MergeBrief constraints

Read [compose.md](./compose.md), [Dockerfile](../../Dockerfile) and [docker-entrypoint.sh](../../docker-entrypoint.sh). Compose remains the documented supported deployment. The image starts `api`, `web`, `worker`, or `migrate`; its default is `api`. Build context must include the repository root. Web defaults to port 3000; Compose configures API on `0.0.0.0:3001`. The worker is continuous and has no HTTP listener. API and worker migrate at boot unless `MERGEBRIEF_AUTO_MIGRATE=false`.

Use PostgreSQL 16+, `sslmode=verify-full`, and an explicit `sslrootcert` path where the provider CA requires it. Dashboard examples using `sslmode=require` must be changed: MergeBrief refuses that mode. Mount CA files into both API and worker. Size database capacity using the pool formula in compose.md, including both worker queues, replicas, and rollout overlap.

## RDS with private EC2 connectivity

- Place EC2 and RDS in the same VPC; keep RDS non-public. Give EC2 an application security group and RDS a separate database security group. Permit RDS inbound TCP 5432 **from the EC2 security-group ID**, not from the internet. If EC2 egress is restricted, permit TCP 5432 to the RDS security group. Security groups do not replace working subnet routing and network ACLs. This follows AWS's [application-server security-group pattern](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html).
- Connect using the RDS endpoint hostname, preserving hostname verification. Download the regional PEM bundle from AWS's [CA bundle table](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html#UsingWithRDS.SSL.CertificatesAllRegions), mount it read-only, and use `sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem`. AWS advises trusting roots, not intermediate certificates, to avoid rotation failures. RDS PostgreSQL 15+ defaults `rds.force_ssl` to on; retain it. Sources: [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html), [certificate lifecycle](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).

## Neon and Supabase connection selection

- **Neon:** select the direct connection in the Connect dialog, with pooling disabled; its hostname lacks `-pooler`. Neon pooling is PgBouncer transaction mode and explicitly lists `LISTEN`/`NOTIFY` and session advisory locks as unsupported. Use direct connections for this deployment, including migrations; do not interpret pooled SQL connectivity as worker compatibility. Source: [Neon pooling and limitations](https://neon.com/docs/connect/connection-pooling).
- **Supabase:** prefer direct `db.<project-ref>.supabase.co:5432`, normally IPv6. For an IPv4-only host, use the dashboard's **Session pooler** connection on port 5432, retaining its supplied hostname and username, or purchase the IPv4 add-on for direct access. Shared pooler transaction mode on 6543 loses session state; the dedicated PgBouncer endpoint is also a transaction-pooling choice, not the session alternative. Sources: [connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [network compatibility](https://supabase.com/kb/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP).
- **Graphile compatibility:** Graphile uses `LISTEN`/`NOTIFY` by default and warns about non-session pooling. Thus direct connections are the safest fit; Supabase session mode is a plausible compatible alternative requiring smoke testing. Do not recommend either provider's transaction pooler for the shipped worker merely because polling sometimes retrieves jobs. Source: [Graphile Worker FAQ](https://worker.graphile.org/docs/faq).

## Vercel Services and Daemons

Current Vercel docs describe both container HTTP Services and continuous Daemons in beta on all plans. A blanket claim that Vercel cannot run containers or workers is obsolete. Vercel does not consume Compose; the three processes need explicit configuration and external PostgreSQL. Sources: [Services](https://vercel.com/docs/services), [Daemons](https://vercel.com/docs/daemons), [Compose mapping](https://vercel.com/i/can-you-run-docker-compose-on-vercel).

### Configuration candidate, not a validated recipe

Use the repository as the Vercel project root. With `vercel.json` there, the following illustrates the documented configuration shape:

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

Service `command` overrides Docker `CMD`; daemon `command` replaces **both** `ENTRYPOINT` and `CMD`, hence the full executable above. Daemons require `root`, Dockerfile-relative `entrypoint`, and regional `instances`; they reject `runtime`, `framework`, and `buildCommand`. The Dockerfile's directory is the daemon build context. Sources: [service configuration](https://vercel.com/docs/services/config-reference), [daemon configuration](https://vercel.com/docs/daemons/config-reference).

The caller binding injects `MERGEBRIEF_API_ORIGIN`; do not supply Compose's `http://api:3001`. Only web needs a public rewrite, preserving its existing API proxy. Bindings work at runtime, not build time. Source: [service bindings](https://vercel.com/docs/services/bindings).

Set project `PORT=3000`, `MERGEBRIEF_WEB_PORT=3000`, `MERGEBRIEF_API_PORT=3000`, and both host variables to `0.0.0.0`: separate containers can share a port, and MergeBrief's own port variables must agree with Vercel's router. Supply the documented app environment and HTTPS `PUBLIC_BASE_URL`. Vercel otherwise expects port 80. HTTP containers scale down after five idle minutes in production, 30 seconds in preview, with 30 seconds after SIGTERM. API periodic work therefore cannot assume continuous uptime. Source: [container runtime](https://vercel.com/docs/functions/runtimes/container).

### Limits that affect this proposal

- Daemons: production only; no inbound application traffic, persistent storage, autoscaling, or `vercel dev` execution. Project root cannot be a subfolder. Linux amd64; memory choices 1/2/4/8 GiB with 1/1/2/4 vCPUs. Default shutdown grace 30 seconds, configurable to 3,600. At most 100 daemons/project, 100 instances/daemon/region, and a default effective cap of 50 instances/project environment. Pro defaults to 16 vCPUs and 32 GiB/team. Hobby allows only 1/2 GiB instances and 5 CPU-hours plus 420 GB-hours/month; either exhaustion stops daemons. An always-on worker therefore needs a paid capacity assessment. Source: [daemon limits](https://vercel.com/docs/daemons/limits).
- Daemons restart even after a successful exit, unlike Compose's `on-failure` policy. Do not add an HTTP liveness probe to the current worker without implementing a listener. Sources: [daemon lifecycle and probes](https://vercel.com/docs/daemons).
- Services inherit Function limits. Published limits include 4.5 MB request/response payloads, 2 GB Hobby / 4 GB paid maximum memory, and bounded request duration. These need reconciling with MergeBrief attachments/media. The documented 1,800-second extended duration and 5 GB large-function beta name specific language runtimes; do not assume they apply to custom containers. Sources: [Services limits](https://vercel.com/docs/services/pricing), [Function limits](https://vercel.com/docs/functions/limitations).
- Custom containers currently lack Secure Compute and Static IPs: do not present the private EC2/RDS networking recipe as directly reusable on Vercel. Images also face VCR limits: 2 GB/compressed layer, 15 GB total compressed image, and two million filesystem entries during optimization. Sources: [container restrictions](https://vercel.com/docs/functions/runtimes/container), [registry limits](https://vercel.com/docs/container-registry/limits-and-pricing).

## Unresolved before calling any provider tested

1. Run the compose smoke checklist against each selected database: migrations, verified TLS, webhook delivery, worker pickup, generated brief, reconnect after database restart, and rollback. Confirm Supabase session-mode notification delivery and actual egress IPv6 from the chosen host.
2. Validate Vercel's shared-root build, image optimization, service commands, binding URL/path handling, Host/Origin checks, OAuth cookies, webhook body signatures, and attachment size behavior. Confirm environment isolation: Services share project environment, whereas Compose deliberately withholds secrets from web.
3. Establish migration ownership and old/new worker overlap during rollouts; test SIGTERM during generation and invalid-config restart behavior. Check API timers under scale-to-zero, pool exhaustion under HTTP autoscaling, and production-only daemon testing strategy.
4. Confirm effective container request/image limits and paid quotas with Vercel before publishing an operational recipe. No source reviewed proves this exact MergeBrief image has been deployed there successfully.
