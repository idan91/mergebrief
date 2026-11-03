# Cloud deployment trial: Hetzner and EC2

This guide is for an operator testing MergeBrief with a real domain and a
small repository. It describes deployment; it does not provision resources.
Provider documentation was checked on 2026-11-01. Commands below are for a
fresh Ubuntu 24.04 LTS VM. Replace example domains and placeholders before
running them. No example contains working credentials.

Compose is the supported application deployment. Track H1 has been run once,
from a source build of main. No other track has been run.

## Choose the experiment

| Track | Application | Database | Purpose |
| --- | --- | --- | --- |
| H1 | Hetzner VM, Compose | Postgres on that VM | Cheapest complete self-host trial |
| H2 | Hetzner VM, Compose | Neon or Supabase | Managed DB connectivity and recovery |
| E1 | EC2, Compose | Postgres on that EC2 instance | Same installation inside AWS |
| E2 | EC2, Compose | Private RDS PostgreSQL | AWS private networking and managed DB |
| E3 | EC2, Compose | Neon or Supabase | Cross-provider managed DB trial |

Start each track with a fresh database and a separate hostname/GitHub App.
Do not point two independent trials at the same database: their workers
would consume the same jobs. Changing DATABASE_URL does not copy existing
data. Moving an existing deployment requires backup, quiescing writers and
restore; see [operations](operations.md).

Start a VM at 2 vCPU and 4 GB RAM with at least 40 GB SSD. This is an initial
sizing hypothesis, not a measured minimum. Image builds may require more
memory than running the application. Keep one API and worker initially.
The worker has two generation slots by default, one ordinary and one large.

## 1. Provision the VM

### Hetzner: H1 or H2

Use these choices on Hetzner's **Create a server** screen. They apply to
both H1 (local Postgres) and H2 (external Postgres).

| Console section | Pick for the first trial | Reason |
| --- | --- | --- |
| Type | Check **Cost-Optimized → x86 (Intel/AMD)** for an available size with at least **2 vCPU / 4 GB RAM / 40 GB SSD**. If unavailable, keep **Regular Performance → CPX22** | CPX22 has 2 vCPU, 4 GB RAM and 80 GB SSD, a reasonable starting point. Dedicated General Purpose is unnecessary for this trial. |
| Location | The location nearest your reviewers and external DB that offers the size | This is a proximity choice, not a measured latency result. |
| Image | **OS Images → Ubuntu → 24.04** using the version dropdown | The console may default to a newer release; select 24.04 to match this guide. Use the plain OS image and install Docker as below. |
| Networking | **Public IPv4 on**, **Public IPv6 on**, **Private networks off** | IPv4 simplifies DNS/SSH; IPv6 can help with direct Supabase access. A Hetzner private network does not automatically connect to Neon, Supabase or RDS. |
| SSH keys | **Add SSH key**, then select your public key | Do this before creation rather than using an emailed root password. See the steps below. |
| Volumes | **None** | The included SSD is enough initially. Docker's named Postgres volume lives on that disk; it is not a separately purchased Hetzner Volume. |
| Firewalls | Create and select **mergebrief-test** with the rules below | Create it before buying the server. |
| Backups | **Off for a disposable first trial**; enable if keeping useful data or configuration | Backups add to the server price. VM backups supplement, rather than replace, database backups. |
| Placement groups | **None** | A single server does not benefit from distributing servers across physical hosts. |
| Labels | Optional: **app=mergebrief**, **environment=test** | Helps identify and clean up the trial. Leave blank if unnecessary. |
| Cloud config | **Leave blank** | Follow the manual installation below. Do not paste application secrets here. |
| Name | **mergebrief-h1-test** or **mergebrief-h2-test** | Makes the database track clear. |
| Server count | **1** | All three app processes run on this VM. |

Read the price in the console's final summary, which changes with location,
type, backups and VAT. External DB and model usage are separate charges.

#### Add the SSH key from your computer

If you already have a suitable SSH key, paste its **public** `.pub` file
into **Add SSH key**. Otherwise, run these on your own computer, not on the
server. Use a new filename and do not overwrite an existing key:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mergebrief_hetzner -C "mergebrief-hetzner"
cat ~/.ssh/mergebrief_hetzner.pub
```

Choose a passphrase when prompted. Paste the printed line into Hetzner, name
it `mergebrief-admin`, and select it. Never upload the file without `.pub`:
that is the private key. After creating the server, connect with:

```sh
ssh -i ~/.ssh/mergebrief_hetzner root@<server-public-ipv4>
```

Replace the placeholder with the address shown by Hetzner. Verify the host
key fingerprint through the server console before accepting it on first
connection. Create a named administrator for ongoing access after setup.

#### Create and attach the firewall

Open **Firewalls** in another tab,
create `mergebrief-test`, then return to the creation form and select it
(refresh if necessary). Confirm it is attached to the server.

| Direction | Protocol / port | Source |
| --- | --- | --- |
| Inbound | TCP 22 | Your current public IPv4 with `/32`; optionally your administrator IPv6 with `/128` |
| Inbound | TCP 80 | Any IPv4 (`0.0.0.0/0`) and any IPv6 (`::/0`) |
| Inbound | TCP 443 | Any IPv4 (`0.0.0.0/0`) and any IPv6 (`::/0`) |
| Inbound | ICMP | Any IPv4 and IPv6, for diagnostics and network error signaling |

To find the address for the SSH rule, open a terminal on your computer and run:

```sh
curl -4 https://icanhazip.com
```

This prints your current public IPv4 address. Run it on the same network
and with the same VPN connection you will use for SSH. Run it locally, not
on the Hetzner server: the rule needs the address you connect **from**.

For example, if the output were `203.0.113.10`, you would enter
`203.0.113.10/32`. Use your actual output, not this example. The `/32`
suffix means "allow this exact IPv4 address." Do not use your computer's local
`192.168.*` address or the Hetzner server's IP.

In the first inbound rule on Hetzner's **Create Firewall** screen:

1. Set the description to `SSH from my network`.
2. Remove **both** source chips: **Any IPv4** and **Any IPv6**.
3. Enter your public IPv4 with `/32` appended, then press Enter to add it.
4. Keep **Protocol: TCP** and **Port: 22**. Leave **Port range** empty.

If your public IP changes after switching Wi-Fi, reconnecting your router
or changing VPN, run the command again and update this rule in Hetzner's
console. The firewall does not prevent you from accessing Hetzner's website
to change the rule. With this IPv4-only SSH rule, connect using the server's
public IPv4 as shown in the SSH command above.

Keep the existing **ICMP** rule with **Any IPv4** and **Any IPv6**. Its port
field is disabled because ICMP carries network diagnostics and error
messages rather than connecting to an application port. It does not grant
terminal access.

Click **Add rule** twice to create separate **TCP 80** and **TCP 443** rules,
each with **Any IPv4** and **Any IPv6**. Leave both port-range fields empty;
do not create a range from 80 through 443. Port 80 supports HTTP redirects
and certificate validation; port 443 serves encrypted application traffic,
GitHub login callbacks and webhooks. IPv4 and IPv6 are the two internet
address formats. Allowing either through the firewall does not bypass SSH
keys or MergeBrief authentication.

Leave **Outbound rules** empty. Under **Apply to → Select Resources**,
select the MergeBrief server if it already exists. Otherwise, create the
firewall and select it in the server creation form. **Labels** can stay
blank; set **Name** to `mergebrief-test`. Confirm the firewall is attached:
creating a firewall without applying it does not protect the server.

Do not add inbound 3000, 3001 or 5432, even for external Postgres: that is an
outbound connection initiated by the application. Leave outbound rules
empty for this trial, permitting package downloads, DNS, GitHub/model HTTPS
and the database connection. An attached Hetzner Firewall blocks unmatched
inbound traffic and allows outbound traffic when no outbound rules exist.
See [firewall semantics](https://docs.hetzner.com/cloud/firewalls/overview/).

For H1, the named Docker volume stores Postgres on the included root disk.
For H2, data is stored by the external provider. Hetzner's
[server backups](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/)
cover the server disk, not separately attached Hetzner Volumes or an external
DB. Keep the backup/restore steps later in this guide for either track.

After creation, point `brief.example.com`'s A record at the public IPv4.
Add an AAAA record only after testing inbound IPv6. Having IPv6 enabled does
not require publishing AAAA. Docker containers also need working outbound
IPv6 before they can use an IPv6-only database endpoint; host connectivity
alone does not establish this. Continue with section 2.

### EC2: E1, E2 or E3

1. Launch Ubuntu Server 24.04 LTS in your chosen AWS region. For example,
   a `t3.medium` has the suggested starting shape. Select architecture to
   match the image you will build or pull.
2. Use an encrypted gp3 root disk, initially 40 GB. Configure an SSH key
   pair and require IMDSv2. You need no AWS access keys inside MergeBrief.
3. For this simple trial, place EC2 in a public subnet with an internet
   gateway route and an Elastic IP. This avoids introducing a NAT gateway
   solely for outbound GitHub/model API access.
4. Create `mergebrief-app` security group: TCP 22 from your administrator
   IP only; TCP 80/443 from the internet. Do not expose 3000/3001/5432.
5. Point your domain at the Elastic IP; connect as `ubuntu`.
6. For E2, create RDS using the private-network instructions below before
   starting the application. E1 needs no RDS resource.

EC2, EBS, snapshots and public IPv4 have separate billing lifecycles.
Stopping a VM does not delete its storage or release every charge. Consult
[AWS security group guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html).

## 2. Install Docker and HTTPS

Install Docker Engine, Buildx and the Compose plugin using the
[official Ubuntu apt-repository instructions](https://docs.docker.com/engine/install/ubuntu/).
Use Compose v2.24 or newer. Install Caddy using its
[official Ubuntu package instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
Use a maintained system service for both:

```sh
sudo systemctl enable --now docker
sudo systemctl enable --now caddy
sudo docker compose version
```

The commands below use `sudo docker`; membership in the docker group is
root-equivalent and is not required. Install `git`, `curl` and `openssl` if
missing. Apply Ubuntu security updates before opening the application.
Docker-published ports can bypass UFW, so keep the shipped loopback bindings
and enforce the cloud firewall too.

Edit `/etc/caddy/Caddyfile`:

```caddyfile
brief.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Validate and reload after DNS points at this host:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy obtains and renews HTTPS certificates. The application itself stays
HTTP on loopback. A temporary 502 is expected until the web service starts.
Do not put browser authentication in front of the GitHub webhook route.
Before sustained public use, apply the webhook rate-limit guidance in
[Compose hardening](compose.md#hardening-before-real-exposure): standard
Caddy does not include a rate limiter.

## 3. Select an exact application version

### Testing current main from source

Use a fresh checkout on the VM, authenticated through your normal repository
access if private. Do not embed a GitHub token in the clone URL. Substitute
the repository URL you have access to:

```sh
mkdir -p ~/deploy
cd ~/deploy
git clone <repository-url> mergebrief
cd mergebrief
git fetch origin main
git checkout --detach origin/main
git rev-parse HEAD
umask 077
cp .env.example .env
```

Record the full SHA with your test results. This fixes the trial to the main
commit fetched at that moment. Do not run `git pull` during the experiment;
move to a newer commit deliberately with
[section 7](#7-move-a-source-build-to-a-newer-commit). The source build reports
version `dev`; it is not a published release.

### Testing an existing release instead

Download the chosen release's Compose file and `.env.example` following
[the release installation instructions](compose.md). For an external DB,
download `docker-compose.external-db.yml` from that same release too. Pin an
exact release, and use `docker compose pull` instead of the source build
below. Do not assume a release or the registry's `dev` tag contains main.

## 4. Configure GitHub, sessions and model access

Edit `.env` locally on the VM with your editor. Never paste secrets into
issues, logs or shell command arguments. Populate these variables from
[GitHub App setup](github-app.md):

```dotenv
GITHUB_APP_ID=<app-id>
GITHUB_APP_PRIVATE_KEY='<complete-multiline-PEM>'
GITHUB_WEBHOOK_SECRET=<random-secret>
GITHUB_OAUTH_CLIENT_ID=<client-id>
GITHUB_OAUTH_CLIENT_SECRET=<client-secret>
SESSION_KEY_V1=<base64-key>
PUBLIC_BASE_URL=https://brief.example.com
ANTHROPIC_API_KEY=<provider-api-key>
```

The PEM placeholder must be replaced with the complete key, including BEGIN
and END lines; Compose accepts a single-quoted multiline value. Set only
one private-key form. Other model providers need the configuration described
in [generators](generators.md), not just a differently named key.

Generate distinct values in a trusted terminal and place them in `.env`:

```sh
openssl rand -hex 32
openssl rand -base64 32
chmod 600 .env
```

The first output is a webhook secret; the second is SESSION_KEY_V1. Keep the
session key in your secret backup: existing encrypted reviewer credentials
need it after database restore. These commands generate secrets for you;
do not capture their output in shared terminal recordings.

Register the App URLs:

- Homepage: `https://brief.example.com`
- Callback: `https://brief.example.com/api/auth/github/callback`
- Webhook: `https://brief.example.com/api/webhooks/github`

Keep user authorization token expiration enabled. Configure permissions and
events exactly as [github-app.md](github-app.md) specifies, then install the
App on the test repository. Activate the webhook after readiness succeeds.

For a trial, choose a low daily generation cap in instance YAML, following
[generator configuration](generators.md). This limits generation count, not
token dollars; also use the model provider's available spending controls.
If you set MERGEBRIEF_CONFIG, mount that YAML read-only into API and worker
as the Compose guide requires. The image does not contain your config.

The `umask 077` from section 3 still applies in this shell, so a config file
created here is unreadable by the containers' UID 1000. Open it up before
starting the stack. It holds env var names, not keys:

```sh
chmod 644 mergebrief.config.yaml
```

## 5A. Database on the same VM: H1 or E1

Before the first boot, generate a separate hex database password:

```sh
openssl rand -hex 24
```

Add the output to `.env`:

```dotenv
POSTGRES_USER=code_review
POSTGRES_PASSWORD=<generated-hex-password>
POSTGRES_DB=code_review
```

Leave COMPOSE_FILE, DATABASE_URL and DATABASE_URL_FILE unset for this track.
The shipped Compose derives the internal connection string automatically.
Use hex literally here, without percent-encoding. Changing the variable
later does not change the password of an already initialized Postgres role.

Run from the checkout:

```sh
sudo docker pull postgres:17-alpine
sudo docker compose build
sudo docker compose up -d --wait --pull never
sudo docker compose ps -a
```

The build uses the selected checkout; `--pull never` prevents replacing it
with a registry image. The explicit Postgres pull supplies the database image on a fresh host.
Release installations instead use
`sudo docker compose pull` and `sudo docker compose up -d --wait`.

Only web is reachable through Caddy. Postgres's host port remains loopback;
API is only on the Compose network. Postgres data lives in its named volume.
Never use `docker compose down -v` unless intentionally deleting trial data.

## 5B. External database: H2, E2 or E3

Use PostgreSQL 16 or newer, preferably 17 to match the bundled reference.
Create an isolated database/project for the trial in a region near the VM.
The API and worker need the same database. The browser and web process do
not need database credentials.

Choose a direct PostgreSQL connection for the first trial. The worker uses
persistent connections, LISTEN/NOTIFY and session behavior; transaction
poolers are not an interchangeable endpoint. Do not replace Postgres with
a provider's REST API. See [provider notes](cloud-provider-notes.md) for
Neon/Supabase endpoint details and current limitations.

### E2: private RDS from EC2

1. Create RDS PostgreSQL 17 in the same VPC and region as EC2. A small
   Single-AZ instance is sufficient for a trial; Multi-AZ tests availability
   at extra cost. Enable encrypted storage and automated backups.
2. Use a DB subnet group covering private subnets in at least two AZs.
   Set **Publicly accessible: No**.
3. Create a DB security group whose inbound TCP 5432 source is the
   `mergebrief-app` security group. Do not use `0.0.0.0/0`. If app egress is
   restricted, allow 5432 to the DB security group.
4. Create database `mergebrief` and a dedicated login that owns that
   database and can create the application/queue schemas. Use the RDS
   administrator only to provision it; do not grant RDS administration to
   the app login. Keep passwords in a secret store.
5. Keep TLS required. Download the appropriate regional CA bundle via the
   official [RDS TLS documentation](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).
   Store the public bundle at `secrets/provider-ca.pem` on the VM.
6. Use the RDS DNS endpoint, never a resolved IP, so hostname verification
   and failover continue working.

An EC2 security group reference provides network admission; it is not a
Postgres login. The connection still needs credentials and verified TLS.
Do not paste a short-lived RDS IAM authentication token into DATABASE_URL:
the current static DSN configuration is not an IAM-token refresh integration.

Private RDS is not reachable directly from Hetzner. Keep it private and
establish a routed VPN/private connectivity if that is the experiment; for the
first cross-cloud trial use Neon/Supabase.

### H2/E3: Neon or Supabase from either VM

1. Create a dedicated project/database and login. Select the same or nearby
   region as the VM; every API/worker database round trip crosses that link.
2. Copy the provider's PostgreSQL connection parameters. Choose Neon's
   **direct, non-pooler** hostname. On Supabase prefer the direct endpoint;
   verify VM IPv6 reachability, or use a supported IPv4 option. A session
   pooler is a separate compatibility test, not the transaction endpoint.
3. Use verified TLS. Replace a dashboard's `sslmode=require` with
   `sslmode=verify-full`. Mount the provider CA when its certificate needs
   one, especially for Supabase; do not disable verification to fix it.
4. Where available on the selected plan, restrict database network access
   to the VM's static outbound IP, including IPv6 if that is the connection
   path. IP restrictions supplement credentials and TLS, not replace them.
5. Check connection limits, backup retention and idle/suspend policy on the
   chosen tier. An always-connected worker can keep a database active;
   do not assume a serverless database bill falls to zero while idle.

### Store the DSN without putting it in command arguments

```sh
mkdir -p secrets
chmod 700 secrets
```

Use an editor to create `secrets/database-url` containing exactly one DSN.
Percent-encode reserved characters in an external DB username/password;
this differs from the bundled POSTGRES_PASSWORD interpolation rule.

Example with a provider CA:

```text
postgresql://mergebrief:<url-encoded-password>@<database-dns>:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

For a publicly trusted certificate, omit `sslrootcert` and its CA mount.
MergeBrief accepts `verify-full` or explicit `disable`, but use only
`verify-full` for these external tracks. `require` is rejected.

Compose file-backed secrets are mounted files, not an encrypted vault.
The image runs as UID 1000; ensure that UID can read the secret file:

```sh
sudo chown 1000:1000 secrets/database-url
sudo chmod 400 secrets/database-url
```

Keep the enclosing host directory private. A CA certificate is public and
may be mode 644. Create `docker-compose.override.yml`:

```yaml
services:
  api:
    secrets:
      - database-url
    volumes:
      - ./secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro
  worker:
    secrets:
      - database-url
    volumes:
      - ./secrets/provider-ca.pem:/etc/ssl/certs/provider-ca.pem:ro
secrets:
  database-url:
    file: ./secrets/database-url
```

If no CA file is needed, remove both volumes blocks. Preserve any instance
YAML mounts already needed by your generator configuration.

Set in `.env`:

```dotenv
COMPOSE_FILE=docker-compose.external-db.yml:docker-compose.override.yml
DATABASE_URL_FILE=/run/secrets/database-url
DATABASE_POOL_MAX=3
MERGEBRIEF_AUTO_MIGRATE=true
```

Remove DATABASE_URL to avoid ambiguity. The external Compose ignores the
bundled POSTGRES_* settings. COMPOSE_FILE explicitly includes the override
because custom file selection disables implicit override loading.

A pool max of 3 is an initial small-trial choice. With one API, one worker,
and large concurrency 1, the documented pool budget is 12 connections:
`3 + (2 * 3 + 1 + 2)`. Leave capacity for migrations, administration and
provider reservations. Raise the pool size only within the DB limit.

Build and start with the same commands as track 5A. For a fresh external
track there is no bundled Postgres to pull. The app login applies migrations
at startup; a private DB still needs DDL permissions for that operation.
For separate migration/runtime roles, follow
[restricted-role migration instructions](compose.md#restricted-database-roles-mergebrief_auto_migratefalse)
instead. Setting AUTO_MIGRATE=false alone does not initialize a database.

## 6. Verify the trial before calling it successful

```sh
sudo docker compose ps -a
curl --fail --show-error https://brief.example.com/healthz
curl --fail --show-error https://brief.example.com/readyz
sudo docker compose logs --tail=80 api worker web
sudo docker compose stats --no-stream
```

Readiness proves the web-to-API-to-database path, not successful generation.
The worker has no HTTP health endpoint, and a configuration error can exit
with code zero. Check that it remains running and actually consumes work.
Avoid `docker compose config` in shared logs: it can print resolved secrets.

Record the commit/image, VM shape, DB type/version, idle and peak usage, and
results of each test:

- Sign in with GitHub; sign out and back in.
- Open a PR on the installed test repository; inspect a successful signed
  webhook delivery and a generated brief.
- Confirm the App posted its Entry comment on that PR. A missing comment does
  not fail the generation, so a successful brief does not prove this.
- Push another commit and verify the new head's brief appears.
- Submit a review from MergeBrief and verify its author/content on GitHub.
- Restart the worker during generation and confirm eventual job recovery
  without a permanently stuck run. Observe provider spend during retries.
- Restart the stack and reboot the VM; confirm persistence and readiness.
- For external DB, confirm verified TLS using the provider's connection
  diagnostics or `pg_stat_ssl` from an authenticated application session.
- Back up and restore into an isolated fresh database, then point an
  isolated trial at it. Do not send duplicate webhooks or run two workers
  against production data while validating restore.

For a local DB, use the [pg_dump and restore procedure](operations.md#backup)
and keep encrypted backups off the VM. For managed DBs, explicitly enable
and test the selected plan's snapshot/PITR functionality. Back up instance
secrets separately, particularly SESSION_KEY_V1. A VM disk snapshot alone
is not proof of a consistent live Postgres backup.

## 7. Move a source build to a newer commit

Back up first if the trial holds data you want to keep
([backup](operations.md#backup)). API and worker apply new migrations when they
start. From the checkout:

```sh
git fetch origin main
git checkout --detach origin/main
git rev-parse HEAD
sudo docker compose build
sudo docker compose up -d --wait --pull never
```

Record the new SHA with your results, then repeat the section 6 checks. A
release installation upgrades through [operations](operations.md#upgrading-to-a-new-version)
instead.

## Troubleshooting and cleanup

| Symptom | First check |
| --- | --- |
| HTTPS 502 | Caddy upstream and web container startup |
| Readiness fails | API logs, DB DNS/routing/firewall, TLS CA and credentials |
| DB rejects SSL mode | Replace require with verify-full; mount correct CA |
| Permission denied reading secret | Mounted file exists and UID 1000 can read it |
| API or worker exits 0, log says `config file: not readable (EACCES)` | `chmod 644 mergebrief.config.yaml`, then restart both |
| Brief generates but no Entry comment on the PR | Worker log 403: [Pull requests write missing or not accepted](troubleshooting.md#no-entry-comment-appears) |
| Login does not persist | HTTPS, exact PUBLIC_BASE_URL and GitHub callback |
| Worker exited but Compose command succeeded | Worker configuration error in logs |
| Webhook succeeds but no brief | Installation, author trigger policy, model key, worker logs |
| External DB times out | IP allowlist, IPv6 availability, private endpoint routing |
| Too many DB connections | All pools and replicas, provider reservations and pool limits |

To retire a trial, disable its GitHub webhook/App installation, save any
needed data and secrets, stop Compose, and delete the intended cloud
resources. Explicitly review VM disks, snapshots, Elastic/public IPs,
managed databases, backup retention and DNS. Only delete volumes once data
is no longer needed. Rotate/revoke trial-only credentials. Deleting EC2
does not delete its separately provisioned RDS database.
