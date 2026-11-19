# Cloud deployment: Hetzner and EC2

This guide deploys a pinned MergeBrief release image on a VM with a real
domain. It describes deployment; it does not provision resources. Provider
documentation was checked on 2026-11-01. Commands below are for a
fresh Ubuntu 24.04 LTS VM. Replace example domains and placeholders before
running them. No example contains working credentials.

Compose is the supported application deployment. The Hetzner tracks have been
run end to end, the external-database one on Neon. The Supabase variant and the
EC2 tracks follow the providers' documentation and have not been run end to end
yet.

## Choose the deployment

| Track | Application | Database | Purpose |
| --- | --- | --- | --- |
| H1 | Hetzner VM, Compose | Postgres on that VM | Cheapest complete self-host |
| H2 | Hetzner VM, Compose | Neon or Supabase | Managed DB connectivity and recovery |
| E1 | EC2, Compose | Postgres on that EC2 instance | Same installation inside AWS |
| E2 | EC2, Compose | Private RDS PostgreSQL | AWS private networking and managed DB |
| E3 | EC2, Compose | Neon or Supabase | Cross-provider managed DB |

Start each track with a fresh database and a separate hostname/GitHub App.
Do not point two instances at the same database: their workers
would consume the same jobs. Changing DATABASE_URL does not copy existing
data. Moving an existing deployment requires backup, quiescing writers and
restore; see [operations](operations.md).

Start a VM at 2 vCPU and 4 GB RAM with at least 40 GB SSD. This is an initial
sizing hypothesis, not a measured minimum. Keep one API and worker initially.
The worker has two generation slots by default, one ordinary and one large.

## 1. Provision the VM

### Hetzner: H1 or H2

Use these choices on Hetzner's **Create a server** screen. They apply to
both H1 (local Postgres) and H2 (external Postgres).

| Console section | Pick for a first deployment | Reason |
| --- | --- | --- |
| Type | Check **Cost-Optimized → x86 (Intel/AMD)** for an available size with at least **2 vCPU / 4 GB RAM / 40 GB SSD**. If unavailable, keep **Regular Performance → CPX22** | CPX22 has 2 vCPU, 4 GB RAM and 80 GB SSD, a reasonable starting point. Dedicated General Purpose is unnecessary at this size. |
| Location | The location nearest your reviewers and external DB that offers the size | This is a proximity choice, not a measured latency result. |
| Image | **OS Images → Ubuntu → 24.04** using the version dropdown | The console may default to a newer release; select 24.04 to match this guide. Use the plain OS image and install Docker as below. |
| Networking | **Public IPv4 on**, **Public IPv6 on**, **Private networks off** | IPv4 simplifies DNS/SSH; IPv6 can help with direct Supabase access. A Hetzner private network does not automatically connect to Neon, Supabase or RDS. |
| SSH keys | **Add SSH key**, then select your public key | Do this before creation rather than using an emailed root password. See the steps below. |
| Volumes | **None** | The included SSD is enough initially. Docker's named Postgres volume lives on that disk; it is not a separately purchased Hetzner Volume. |
| Firewalls | Create and select **mergebrief-test** with the rules below | Create it before buying the server. |
| Backups | **Off for a disposable first deployment**; enable if keeping useful data or configuration | Backups add to the server price. VM backups supplement, rather than replace, database backups. |
| Placement groups | **None** | A single server does not benefit from distributing servers across physical hosts. |
| Labels | Optional: **app=mergebrief**, **environment=test** | Helps identify and clean up this VM. Leave blank if unnecessary. |
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
empty for a first deployment, permitting package downloads, DNS, GitHub/model HTTPS
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

These steps follow AWS's documentation as of 2026-11-04 and have not been run
end to end yet. Console wording moves, so where a label differs, pick the nearest one.

In the [EC2 console](https://console.aws.amazon.com/ec2/), select your region at
the top right, then click **Launch instance**:

| Console section | Pick for a first deployment | Reason |
| --- | --- | --- |
| Name | **mergebrief-e2-test** (or `e1`, `e3`) | Makes the database track clear. |
| Application and OS Images | **Quick Start → Ubuntu → Ubuntu Server 24.04 LTS**, **64-bit (x86)** | Matches this guide. `t3` instances are x86. |
| Instance type | **t3.medium** | 2 vCPU and 4 GB, the suggested starting shape. |
| Key pair | **Create new key pair**: name `mergebrief-admin`, type **ED25519**, format **.pem** | Your browser downloads the private key once. |
| Network settings | Click **Edit**. Keep the default **VPC**, any **Subnet**, **Auto-assign public IP: Enable** | A default subnet routes to an internet gateway, so outbound GitHub and model traffic needs no NAT gateway. |
| Firewall (security groups) | **Create security group** named `mergebrief-app`, with the rules below | Do not expose 3000, 3001 or 5432. |
| Configure storage | **40 GiB gp3**. Under **Advanced**, set **Encrypted: Yes** | Room for the images, the Postgres volume and logs. |
| Advanced details | **Metadata version: V2 only (token required)**. Leave **IAM instance profile** empty | MergeBrief needs no AWS access keys. |

| Type | Source |
| --- | --- |
| SSH | **My IP** |
| HTTP | **Anywhere** |
| HTTPS | **Anywhere** |

Port 80 supports redirects and certificate validation; 443 serves the
application, GitHub login callbacks and webhooks. **My IP** is your address at
that moment. If it changes, for example on a VPN, update the SSH rule in
`mergebrief-app`. Otherwise SSH hangs.

After launching, on your own computer, protect the key:

```sh
mv ~/Downloads/mergebrief-admin.pem ~/.ssh/
chmod 400 ~/.ssh/mergebrief-admin.pem
```

Give the instance an address that survives a stop:

1. Open **Network & Security → Elastic IPs**, click **Allocate Elastic IP
   address**, then **Allocate**.
2. Select it, then **Actions → Associate Elastic IP address**. Set **Resource
   type** to **Instance**, choose the instance, and click **Associate**.
3. Point `brief.example.com`'s A record at that address.
4. Connect as `ubuntu`:

   ```sh
   ssh -i ~/.ssh/mergebrief-admin.pem ubuntu@<elastic-ip>
   ```

Continue with section 2. E2 creates its database in
[section 5B](#e2-private-rds-from-ec2), once this instance exists; E1 needs no
RDS resource.

EC2, EBS, snapshots and public IPv4 have separate billing lifecycles.
Stopping a VM does not delete its storage or release every charge. Consult
[AWS security group guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html).

## 2. Install Docker and HTTPS

Install Docker Engine and the Compose plugin using the
[official Ubuntu apt-repository instructions](https://docs.docker.com/engine/install/ubuntu/).
Use Compose v2.24.4 or newer. Install Caddy using its
[official Ubuntu package instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
Use a maintained system service for both:

```sh
sudo systemctl enable --now docker
sudo systemctl enable --now caddy
sudo docker compose version
```

The commands below use `sudo docker`; membership in the docker group is
root-equivalent and is not required. Install `curl` and `openssl` if
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

Download the assets of the release you intend to deploy, as in the
[Compose installation guide](compose.md). The host holds one folder, with no
checkout of the repository and no build. These commands fetch the newest
release; for another one, replace `latest/download` with `download/vX.Y.Z` in
every URL, from the
[releases page](https://github.com/idan91/mergebrief/releases).

```sh
mkdir -p ~/deploy/mergebrief
cd ~/deploy/mergebrief
umask 077
curl -fsSLo docker-compose.yml https://github.com/idan91/mergebrief/releases/latest/download/docker-compose.yml
curl -fsSLo .env.example https://github.com/idan91/mergebrief/releases/latest/download/env.example
curl -fsSLo mergebrief.config.example.yaml https://github.com/idan91/mergebrief/releases/latest/download/mergebrief.config.example.yaml
cp .env.example .env
cp mergebrief.config.example.yaml mergebrief.config.yaml
```

For H2, E2 or E3, also download the external-database overlay from the same
release. Section 5B names it in `COMPOSE_FILE` after `docker-compose.yml`, and
Compose then reads both, the overlay removing the bundled database:

```sh
curl -fsSLo docker-compose.external-db.yml https://github.com/idan91/mergebrief/releases/latest/download/docker-compose.external-db.yml
```

Each release's Compose files pin that release's exact image tag,
such as `ghcr.io/idan91/mergebrief:1.4.0`, never `latest`. Do not edit them: an
upgrade replaces them byte for byte. Your own settings go in `.env` and
`docker-compose.override.yml`. Finish sections 4 and 5 before starting the
services.

Contributors testing unpublished changes build from source instead: see the
[appendix](#appendix-source-builds-for-contributors).

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
To replace GitHub's generated badge, upload the MergeBrief
[logo](github-app.md#logo).

An instance starts closed: nobody can sign in until its config names them.
In the `mergebrief.config.yaml` you copied in section 3, replace the
placeholder under `operators` with your GitHub user id, which
`gh api users/<login> --jq .id` prints
([who may start a brief](generators.md#who-may-start-a-brief)):

```yaml
operators:
  - 583231
```

That covers repositories on your own account. For a test repository in an
organization, also list the organization under `allowed.accounts`, or its
deliveries start nothing.

`docker-compose.yml` mounts the file read-only into API and worker and sets
`MERGEBRIEF_CONFIG` for both. The image does not contain your config, and
Compose refuses to start either service while the file is missing.

For a first deployment, also choose a low daily generation cap in that file, following
[generator configuration](generators.md). This limits generation count, not
token dollars; also use the model provider's available spending controls.

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
POSTGRES_USER=mergebrief
POSTGRES_PASSWORD=<generated-hex-password>
POSTGRES_DB=mergebrief
```

Leave COMPOSE_FILE, DATABASE_URL and DATABASE_URL_FILE unset for this track.
The shipped Compose derives the internal connection string automatically.
Use hex literally here, without percent-encoding. Changing the variable
later does not change the password of an already initialized Postgres role.

Run from `~/deploy/mergebrief`:

```sh
sudo docker compose pull
sudo docker compose up -d --wait
sudo docker compose ps -a
```

`pull` fetches the image the release's Compose file pins, and Postgres with it.

Only web is reachable through Caddy. Postgres's host port remains loopback;
API is only on the Compose network. Postgres data lives in its named volume.
Never use `docker compose down -v` unless intentionally deleting the instance's data.

## 5B. External database: H2, E2 or E3

Use PostgreSQL 16 or newer, preferably 17 to match the bundled reference.
Create an isolated database/project for this instance in a region near the VM.
The API and worker need the same database. The browser and web process do
not need database credentials.

The worker uses persistent connections, LISTEN/NOTIFY and session behavior, and
the boot migrations take a session advisory lock, so never use a transaction
pooler, and do not replace Postgres with a provider's REST API. Follow your provider's steps below, then
[store the connection string](#store-the-connection-string).
[Provider notes](cloud-provider-notes.md) has the sources behind these choices.

### E2: private RDS from EC2

These steps follow AWS's documentation as of 2026-11-04 and have not been run
on RDS yet. The commands in steps 5 and 6, the migrations and the TLS check were
rehearsed on Postgres 17 with a non-superuser admin, a TLS-only server and a
private CA bundle.

1. In the [RDS console](https://console.aws.amazon.com/rds/), in the same region
   as the instance, open **Databases → Create database**:

   | Field | Value | Reason |
   | --- | --- | --- |
   | Creation method | **Standard create** (may read **Full configuration**) | **Easy create** hides the version and backup settings. |
   | Engine | **PostgreSQL**, the newest **17** version | Matches the bundled reference. |
   | Template | **Dev/Test** or **Sandbox**, never **Production** | **Production** preselects Multi-AZ and paid IOPS storage. |
   | Availability | **Single DB instance** | Multi-AZ tests availability at extra cost. |
   | DB instance identifier | `mergebrief-e2-test` | Becomes part of the endpoint. |
   | Master username | `postgres` | Used only to provision the app login below. |
   | Credentials management | **Self managed**. Generate a password in your password manager | You type it once in step 5. |
   | Instance class | **Burstable classes → db.t4g.micro** | Enough for a first deployment. The app's budget below is 12 connections. |
   | Storage | **General Purpose SSD (gp3)**, 20 GiB, encryption on | |
   | Compute resource | **Connect to an EC2 compute resource**, then your instance | See below. |
   | Certificate authority | Leave the default, `rds-ca-rsa2048-g1` | It is in every regional bundle. |
   | Initial database name | Leave empty | Step 6 creates the database with the right owner. |
   | Backups | Automated backups on, 7 days | |
   | Deletion protection | Off for a disposable database | |

   **Connect to an EC2 compute resource** does the private networking. RDS sets
   **Public access: No**, picks or creates a DB subnet group with private subnets
   only, and adds two security groups: `rds-ec2-n` on the database, admitting
   only the instance, and `ec2-rds-n` on the instance. A default VPC has no
   private subnets, so without this option you build them yourself. Do not edit
   these groups afterwards: RDS reuses them only if they stay unmodified.
2. Wait for status **Available**. On the database's **Connectivity & security**
   tab, copy the **Endpoint**. Use this DNS name, never a resolved IP, so hostname
   verification and failover keep working.
3. On the VM, from `~/deploy/mergebrief`, download your region's CA bundle from
   [AWS's list](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html#UsingWithRDS.SSL.CertificatesAllRegions).
   The `chmod` matters: the `umask 077` from section 3 leaves the file private,
   and the containers read it as UID 1000. A CA certificate is public.

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   curl --fail --show-error --silent \
     --output secrets/provider-ca.pem \
     https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem
   chmod 644 secrets/provider-ca.pem
   ```

4. Generate the app login's password and save it in your password manager. Hex
   needs no percent-encoding in a connection string:

   ```sh
   openssl rand -hex 24
   ```

5. Open `psql` as the administrator. The database is private, so this has to run
   on the VM, and Docker supplies the client. Connecting at all proves the
   security groups and TLS. It prompts for the master password:

   ```sh
   sudo docker run --rm -it \
     -v "$PWD/secrets/provider-ca.pem:/ca.pem:ro" \
     postgres:17-alpine \
     psql "host=<rds-endpoint> port=5432 dbname=postgres user=postgres sslmode=verify-full sslrootcert=/ca.pem"
   ```

6. Create the login and the database it owns. `\password` prompts for the
   password from step 4, which keeps it out of the server's logs:

   ```sql
   CREATE ROLE mergebrief_app LOGIN;
   \password mergebrief_app
   GRANT mergebrief_app TO CURRENT_USER;
   CREATE DATABASE mergebrief OWNER mergebrief_app;
   \q
   ```

   The `GRANT` is required. The RDS master user is not a superuser, and on
   Postgres 16 and newer it must be a member of a role to make it an owner;
   otherwise the last statement answers `must be able to SET ROLE`. As owner,
   `mergebrief_app` can create the application and queue schemas, and it holds no
   RDS administration.

The finished string looks like this:

```text
postgresql://mergebrief_app:<hex-password>@mergebrief-e2-test.abc123xyz.eu-central-1.rds.amazonaws.com:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

`/etc/ssl/certs/provider-ca.pem` is the path inside the containers, where the
override below mounts the bundle. Continue with
[Store the connection string](#store-the-connection-string), and keep the
provider CA override.

An EC2 security group reference provides network admission; it is not a
Postgres login. The connection still needs credentials and verified TLS.
Do not paste a short-lived RDS IAM authentication token into DATABASE_URL:
the current static DSN configuration is not an IAM-token refresh integration.

Private RDS is not reachable directly from Hetzner. Keep it private and
establish a routed VPN/private connectivity if that is what you are testing;
for a first cross-cloud deployment use Neon/Supabase.

### H2/E3: Neon

These steps follow Neon's documentation as of 2026-11-03. Track H2 has run them
once.

1. In the [Neon console](https://console.neon.tech), create a project:

   | Field | Value |
   | --- | --- |
   | Project name | `mergebrief-h2-test` |
   | Postgres version | 17 |
   | Region | The one closest to your VM. Every API and worker query crosses this link. |
	
2. Click **Connect**. If Neon offers an agent prompt, choose **wire it myself**:
   that prompt edits application code and `.env`, and MergeBrief needs only
   the connection string. Keep the default branch, compute, database and role.
   That role owns the database, so it can create the app's schemas.
3. Turn off **Connection pooling**. Check that the hostname no longer contains
   `-pooler`.
4. Copy the connection string, then change its ending:

   | Neon shows | Use instead |
   | --- | --- |
   | `?sslmode=require&channel_binding=require` | `?sslmode=verify-full` |

   MergeBrief refuses `require` at boot, and its database driver ignores
   `channel_binding` in the URL. Neon's certificate chains to a public root
   (ISRG Root X1), so you need no CA file.

The finished string looks like this:

```text
postgresql://neondb_owner:<password>@ep-example-a1b2c3d4.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full
```

Neon's Free plan gives 100 CU-hours a month, which is 400 hours at 0.25 CU, or
about 16 days of continuous running. The worker polls its queue every 2 seconds,
so expect the compute not to scale to zero and the allowance to drain around the
clock; this is not yet measured. When it runs out, Neon suspends the compute
until the next billing period and the app loses its database. Keep the compute
at 0.25 CU for a first deployment.

Continue with [Store the connection string](#store-the-connection-string).

### H2/E3: Supabase

These steps follow Supabase's documentation as of 2026-11-03 and have not been
run end to end yet.

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a project:

   | Field | Value |
   | --- | --- |
   | Project name | `mergebrief-h2-test` |
   | Database password | Generate one and save it in your password manager |
   | Region | The one closest to your VM. Every API and worker query crosses this link. |

2. Click **Connect** at the top of the project, then choose **Session pooler**:

   | Option | Use it? | Why |
   | --- | --- | --- |
   | Session pooler | Yes | Reachable over IPv4 on every plan, and keeps the sessions the worker needs |
   | Direct connection | No | IPv6 only without the paid IPv4 add-on, and Compose containers have no IPv6 route by default |
   | Transaction pooler | Never | It drops the session state the worker relies on |

3. Copy the connection string and replace `[YOUR-PASSWORD]` with your password.
   Percent-encode any reserved character in it, such as `&`, `#`, `?`, `@`, `/`
   or a space. Keep the host and the `postgres.<project-ref>` username as shown.
4. Open the project's **Database Settings** page and download the CA certificate
   from its **SSL Configuration** section.
5. On the VM, from `~/deploy/mergebrief`, create the folder for it:

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   ```

6. On your computer, copy the certificate over, using the file you downloaded. On
   EC2 the login is `ubuntu`, not `root`:

   ```sh
   scp <downloaded-ca-file> root@<server-public-ipv4>:~/deploy/mergebrief/secrets/provider-ca.pem
   ```

7. On the VM, let the containers read it. A CA certificate is public:

   ```sh
   chmod 644 secrets/provider-ca.pem
   ```

8. Add `?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem` to the
   end of the connection string. If TLS fails, fix the certificate. Never turn
   verification off to get past it.

The finished string looks like this:

```text
postgresql://postgres.abcdefghijklmnop:<url-encoded-password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

The session pooler holds one database connection per client, and the Free plan's
default pool size is 15. The `DATABASE_POOL_MAX=3` set below needs up to 12, so
leave it at 3. Supabase's session mode is also the least proven path here: when
you reach [section 6](#6-verify-the-deployment), confirm
that a push actually produces a brief.

### Store the connection string

Run these on the VM, from `~/deploy/mergebrief`.

1. Create the file. Paste the single line, then save. Typing it into an editor
   keeps the password out of your shell history:

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   nano secrets/database-url
   ```

2. Let the container's user read it. The image runs as UID 1000:

   ```sh
   sudo chown 1000:1000 secrets/database-url
   sudo chmod 400 secrets/database-url
   ```

3. Create `docker-compose.override.yml`. If one already exists, merge these
   entries into it instead of replacing it.

   With a public certificate (Neon):

   ```yaml
   services:
     api:
       secrets:
         - database-url
     worker:
       secrets:
         - database-url
   secrets:
     database-url:
       file: ./secrets/database-url
   ```

   With a provider CA (Supabase, RDS):

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

4. Add these to `.env`, and remove any `DATABASE_URL` line:

   ```dotenv
   COMPOSE_FILE=docker-compose.yml:docker-compose.external-db.yml:docker-compose.override.yml
   DATABASE_URL_FILE=/run/secrets/database-url
   DATABASE_POOL_MAX=3
   MERGEBRIEF_AUTO_MIGRATE=true
   ```

5. Pull and start:

   ```sh
   sudo docker compose pull
   sudo docker compose up -d --wait
   sudo docker compose ps -a
   ```

The overlay removes the bundled `postgres` service, so the `POSTGRES_*`
settings no longer apply. `COMPOSE_FILE` lists the override because setting it turns off the automatic
override load. Compose file-backed secrets are mounted files, not an encrypted
vault, so keep the `secrets` folder private. If your plan offers an IP
allowlist, restrict the database to the VM's address too.

A pool max of 3 is an initial choice for a small instance. With one API, one worker,
and large concurrency 1, the documented pool budget is 12 connections:
`3 + (2 * 3 + 1 + 2)`. Leave capacity for migrations, administration and
provider reservations. Raise the pool size only within the DB limit.

The app login applies migrations at startup, so it needs DDL permissions. For
separate migration and runtime roles, follow
[restricted-role migration instructions](compose.md#restricted-database-roles-mergebrief_auto_migratefalse)
instead. Setting AUTO_MIGRATE=false alone does not initialize a database.

### Moving an existing H1 server to an external database

To reuse a running H1 server instead of a new one, stop it **before** you change
`.env`. Once `COMPOSE_FILE` is set, Compose no longer knows the `postgres`
service:

```sh
sudo docker compose down
```

Never add `-v`: that deletes the Postgres volume. An H1 folder installed from
a release holds no external-database overlay, because section 3 downloads
it only for the external tracks. Download it now, from the release this
instance runs: the first command prints the version `docker-compose.yml` pins,
and a pin of `1.4.0` is `v1.4.0` in the URL. A source build skips this step,
because its checkout already holds the file.

```sh
grep 'image: ghcr.io/idan91/mergebrief' docker-compose.yml
curl -fsSLo docker-compose.external-db.yml https://github.com/idan91/mergebrief/releases/download/v1.4.0/docker-compose.external-db.yml
```

Then follow your provider's steps and
[Store the connection string](#store-the-connection-string), merging the
override with the one you have.

Data does not move. The new database starts empty, so everyone signs in again
and each pull request gets its next brief on its next push. Keep the same
hostname and GitHub App only while the H1 stack stays stopped.

To switch back, run `down` again, remove `COMPOSE_FILE` and `DATABASE_URL_FILE`
from `.env`, take the database entries out of the override, and start the stack
with the section 5A commands.

## 6. Verify the deployment

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

Then check the instance end to end:

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
  isolated instance at it. Do not send duplicate webhooks or run two workers
  against production data while validating restore.

For a local DB, use the [pg_dump and restore procedure](operations.md#backup)
and keep encrypted backups off the VM. For managed DBs, explicitly enable
and test the selected plan's snapshot/PITR functionality. Back up instance
secrets separately, particularly SESSION_KEY_V1. A VM disk snapshot alone
is not proof of a consistent live Postgres backup.

For E2, repeat the `psql` command from [step 5](#e2-private-rds-from-ec2) while
the stack runs. Every row should show `ssl` as `t`:

```sql
SELECT a.usename, s.ssl, s.version
FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
WHERE a.usename = 'mergebrief_app';
```

Then, on your own computer, confirm the database is private. This should end in
a private address, such as `172.31.x.x`:

```sh
dig +short <rds-endpoint>
```

## 7. Upgrade to a new release

Follow [upgrading to a new version](operations.md#upgrading-to-a-new-version).
It covers the backup, the replacement Compose file, the external-database
variant and rollback. Repeat the section 6 checks afterwards.

Its commands run bare `docker`. On a VM set up by this guide, run them as
written from a root shell, in the folder section 3 created. That folder sits
under the home of the account that ran section 3: `/root` on Hetzner,
`/home/ubuntu` on EC2.

```sh
sudo -s
cd /root/deploy/mergebrief   # on EC2: /home/ubuntu/deploy/mergebrief
```

Do not put `sudo` in front of each line instead. `sudo` drops variables set
before a command, and one of the upgrade commands passes the database
connection string that way. Leave the root shell with `exit` when the upgrade
is done.

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
| External DB times out | IP allowlist, IPv6 availability, private endpoint routing; on RDS, that **Connected compute resources** lists the instance |
| `CREATE DATABASE` answers `must be able to SET ROLE` | Run the `GRANT` in [section 5B](#e2-private-rds-from-ec2) first |
| API or worker logs `unable to verify the first certificate` | The DSN's `sslrootcert`, and that the bundle is for the database's region |
| Too many DB connections | All pools and replicas, provider reservations and pool limits |

To retire an instance, disable its GitHub webhook/App installation, save any
needed data and secrets, stop Compose, and delete the intended cloud
resources. Explicitly review VM disks, snapshots, Elastic/public IPs,
managed databases, backup retention and DNS. Only delete volumes once data
is no longer needed. Rotate/revoke credentials only that instance used. Deleting EC2
does not delete its separately provisioned RDS database. Deleting the database
does not remove its DB subnet group, private subnets or its `rds-ec2-n` and
`ec2-rds-n` security groups. An Elastic IP keeps billing until released.

## Appendix: source builds for contributors

This path is for working on MergeBrief and testing unpublished changes. It is
not an installation or upgrade path: a source build reports version `dev`,
never checks for releases, and is not a published release. It needs `git` and
Docker Buildx on the VM, and an image build may need more memory than running
the application.

### Build current main

Replace section 3 with a fresh checkout of the repository or your fork. Do not
embed a GitHub token in the clone URL:

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
cp mergebrief.config.example.yaml mergebrief.config.yaml
```

Record the full SHA with your test results: it fixes the build to the main
commit fetched at that moment. Do not run `git pull` while testing; move to a
newer commit deliberately with
[the steps below](#move-a-source-build-to-a-newer-commit).

Follow sections 4 and 5 from the checkout, with one change. Wherever they run
`sudo docker compose pull` and `sudo docker compose up -d --wait`, build
instead:

```sh
sudo docker pull postgres:17-alpine
sudo docker compose build
sudo docker compose up -d --wait --pull never
```

The build uses the selected checkout, and `--pull never` stops Compose from
replacing it with a registry image. The explicit Postgres pull supplies the
database image on a fresh host; skip it on an external database.

### Move a source build to a newer commit

Back up first if the instance holds data you want to keep
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
release installation upgrades through
[operations](operations.md#upgrading-to-a-new-version) instead.
