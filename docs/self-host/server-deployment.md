# Deploy on a server

This guide deploys a pinned MergeBrief release image on one Linux server with a real domain. It works on any provider: it states what the server and database need, not which buttons a provider's console shows. Commands are for a fresh Ubuntu 24.04 LTS server. Replace example domains and placeholders before running them. No example contains working credentials.

Compose is the supported application deployment. A VPS with bundled Postgres and a VPS with managed Postgres (Neon) have each been run once, from source builds of main. No setup has been run from a release image yet, and a cloud VM with a private managed database has not been run at all.

## Choose the setup

Make two choices. The steps are the same for every combination except where a section names one.

| Choice | Option | What it means |
| --- | --- | --- |
| Host | **VPS** | One rented server with a public IP and the provider's firewall panel. The cheapest complete self-host. |
| Host | **Cloud VM** | An instance inside a cloud account, in a virtual network with security groups. Choose it when the database should stay on a private network in the same account. |
| Database | **Bundled Postgres** | The Compose file's own Postgres, on the server's disk. |
| Database | **Managed Postgres** | A provider runs Postgres. Either hosted and reached over the internet with verified TLS, or a cloud database on the same private network as a cloud VM. |

A private cloud database is reachable only from inside its network. From a VPS or another provider, use a database reachable over the internet, or build routed private connectivity first.

Start each instance with a fresh database and its own hostname and GitHub App. Do not point two instances at the same database: their workers would consume the same jobs. Changing `DATABASE_URL` does not copy existing data. Moving an existing deployment requires backup, quiescing writers and restore; see [operations](operations.md).

## 1. Provision the server

Create one server with:

| Setting | Value | Reason |
| --- | --- | --- |
| OS image | Ubuntu 24.04 LTS, x86-64 | Matches this guide. Use the plain OS image; Docker is installed below. |
| Size | 2 vCPU, 4 GB RAM, 40 GB SSD | An initial sizing hypothesis, not a measured minimum. One API and one worker; the worker has two generation slots, one ordinary and one large. |
| Location | Nearest your reviewers and, for managed Postgres, the database | Every API and worker query crosses the link to the database. |
| Public IPv4 | On, and static | DNS points at it. On a cloud VM, a default public IP changes on stop: reserve a static one and associate it. |
| SSH access | Your public key, added at creation | Avoids an emailed root password. |
| Disk encryption, metadata service | Encrypt the disk if offered. On a cloud VM, require token-based metadata access and attach no instance role | MergeBrief needs no cloud credentials. |
| Startup script (cloud-init, user data) | Empty | Follow the manual installation below. Never paste application secrets there. |
| Backups | Off for a disposable first deployment; on once it holds data you keep | Server snapshots supplement database backups; they do not replace them. |

Read the price in the provider's final summary. A managed database and model usage are separate charges.

### SSH key

If you have no suitable key, create one on your own computer, with a new filename so nothing is overwritten:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mergebrief -C "mergebrief-admin"
cat ~/.ssh/mergebrief.pub
```

Choose a passphrase. Give the provider the printed `.pub` line, never the file without `.pub`: that is the private key. If the provider generates the key pair instead, move the downloaded private key to `~/.ssh/` and run `chmod 400` on it.

Connect with the login user your image uses, often `root` on a VPS and `ubuntu` on a cloud VM:

```sh
ssh -i ~/.ssh/mergebrief <login-user>@<server-public-ipv4>
```

Verify the host key fingerprint through the provider's web console before accepting it on first connection. Create a named administrator for ongoing access after setup.

### Firewall

Attach a firewall (a VPS firewall or a cloud security group) to the server with these inbound rules and nothing else:

| Protocol / port | Source | Purpose |
| --- | --- | --- |
| TCP 22 | Your current public IP only, as `/32` (IPv6: `/128`) | SSH |
| TCP 80 | Anywhere, IPv4 and IPv6 | HTTP redirect and certificate validation |
| TCP 443 | Anywhere, IPv4 and IPv6 | The application, GitHub login callbacks and webhooks |
| ICMP | Anywhere | Diagnostics and network error signaling; optional |

Find your public IP by running `curl -4 https://icanhazip.com` on your own computer, on the network and VPN you will SSH from. Not your local `192.168.*` address, and not the server's. If it changes, update the SSH rule or SSH hangs.

Never open 3000, 3001 or 5432, managed Postgres included: the database connection is outbound from the server. Leave outbound traffic unrestricted for a first deployment; it carries package downloads, DNS, GitHub and model HTTPS, and the database connection. Confirm the firewall is attached to the server: a firewall that exists but is not applied protects nothing.

### DNS

Point `brief.example.com`'s A record at the server's static public IPv4. Add an AAAA record only after testing inbound IPv6. Docker containers also need working outbound IPv6 before they can reach an IPv6-only database endpoint; host connectivity alone does not establish this.

## 2. Install Docker and HTTPS

Install Docker Engine and the Compose plugin using the [official Ubuntu apt-repository instructions](https://docs.docker.com/engine/install/ubuntu/). Use Compose v2.24 or newer. Install Caddy using its [official Ubuntu package instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian). Run both as system services:

```sh
sudo systemctl enable --now docker
sudo systemctl enable --now caddy
sudo docker compose version
```

The commands below use `sudo docker`; membership in the docker group is root-equivalent and is not required. Install `curl` and `openssl` if missing. Apply Ubuntu security updates before opening the application. Docker-published ports can bypass UFW, so keep the shipped loopback bindings and rely on the provider firewall.

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

Caddy obtains and renews HTTPS certificates. The application itself stays HTTP on loopback. A temporary 502 is expected until the web service starts. Do not put browser authentication in front of the GitHub webhook route. Before sustained public use, apply the webhook rate-limit guidance in [Compose hardening](compose.md#hardening-before-real-exposure): standard Caddy does not include a rate limiter.

## 3. Select an exact application version

Download the assets of the exact release you intend to deploy, as in the [Compose installation guide](compose.md). The server holds one folder, with no checkout of the repository and no build. These commands select `v0.1.0`, the first release; replace that version in every URL to select another one from the [releases page](https://github.com/Idan91/mergebrief/releases).

```sh
mkdir -p ~/deploy/mergebrief
cd ~/deploy/mergebrief
umask 077
curl -fsSLo docker-compose.yml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/docker-compose.yml
curl -fsSLo .env.example https://github.com/Idan91/mergebrief/releases/download/v0.1.0/env.example
curl -fsSLo mergebrief.config.example.yaml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/mergebrief.config.example.yaml
cp .env.example .env
cp mergebrief.config.example.yaml mergebrief.config.yaml
```

For managed Postgres, also download the external-database overlay from the same release. Section 5B names it in `COMPOSE_FILE` after `docker-compose.yml`, and Compose then reads both, the overlay removing the bundled database:

```sh
curl -fsSLo docker-compose.external-db.yml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/docker-compose.external-db.yml
```

Each release's Compose files pin that release's exact image tag, `ghcr.io/idan91/mergebrief:0.1.0` here, never `latest`. Do not edit them: an upgrade replaces them byte for byte. Your own settings go in `.env` and `docker-compose.override.yml`. Finish sections 4 and 5 before starting the services.

Contributors testing unpublished changes build from source instead: see the [appendix](#appendix-source-builds-for-contributors).

## 4. Configure GitHub, sessions and model access

Edit `.env` on the server with your editor. Never paste secrets into issues, logs or shell command arguments. Populate these variables from [GitHub App setup](github-app.md):

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

The PEM placeholder must be replaced with the complete key, including BEGIN and END lines; Compose accepts a single-quoted multiline value. Set only one private-key form. Other model providers need the configuration described in [generators](generators.md), not just a differently named key.

Generate distinct values in a trusted terminal and place them in `.env`:

```sh
openssl rand -hex 32
openssl rand -base64 32
chmod 600 .env
```

The first output is a webhook secret; the second is `SESSION_KEY_V1`. Keep the session key in your secret backup: existing encrypted reviewer credentials need it after a database restore. Do not capture this output in shared terminal recordings.

Register the App URLs:

- Homepage: `https://brief.example.com`
- Callback: `https://brief.example.com/api/auth/github/callback`
- Webhook: `https://brief.example.com/api/webhooks/github`

Keep user authorization token expiration enabled. Configure permissions and events exactly as [github-app.md](github-app.md) specifies, then install the App on the test repository. Activate the webhook after readiness succeeds.

An instance starts closed: nobody can sign in until its config names them. In the `mergebrief.config.yaml` you copied in section 3, replace the placeholder under `operators` with your GitHub user id, which `gh api users/<login> --jq .id` prints ([who may start a brief](generators.md#who-may-start-a-brief)):

```yaml
operators:
  - 583231
```

That covers repositories on your own account. For a test repository in an organization, also list the organization under `allowed.accounts`, or its deliveries start nothing.

`docker-compose.yml` mounts the file read-only into API and worker and sets `MERGEBRIEF_CONFIG` for both. The image does not contain your config, and Compose refuses to start either service while the file is missing.

For a first deployment, also choose a low daily generation cap in that file, following [generator configuration](generators.md). This limits generation count, not token dollars; also use the model provider's spending controls.

The `umask 077` from section 3 still applies in this shell, so the config file is unreadable by the containers' UID 1000. Open it up before starting the stack. It holds env var names, not keys:

```sh
chmod 644 mergebrief.config.yaml
```

## 5A. Bundled Postgres

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

Leave `COMPOSE_FILE`, `DATABASE_URL` and `DATABASE_URL_FILE` unset. The shipped Compose derives the internal connection string automatically. Hex needs no percent-encoding. Changing the variable later does not change the password of an already initialized Postgres role.

Run from `~/deploy/mergebrief`:

```sh
sudo docker compose pull
sudo docker compose up -d --wait
sudo docker compose ps -a
```

`pull` fetches the image the release's Compose file pins, and Postgres with it.

Only web is reachable, through Caddy. Postgres's host port stays on loopback; the API is only on the Compose network. Postgres data lives in its named volume on the server's disk. Never use `docker compose down -v` unless intentionally deleting the instance's data.

## 5B. Managed Postgres

### What the database must provide

- PostgreSQL 16 or newer, preferably 17 to match the bundled reference.
- An isolated database for this instance, in a region near the server. API and worker share it; the browser and web process need no database credentials.
- **A direct or session-mode connection, never a transaction pooler.** The worker keeps persistent connections and uses `LISTEN`/`NOTIFY`, and the boot migrations take a session advisory lock. A provider's REST or HTTP API does not replace Postgres.
- **Verified TLS:** the connection string ends in `sslmode=verify-full`. MergeBrief refuses `require` at boot. If the provider's certificate does not chain to a public root, add `sslrootcert=/etc/ssl/certs/provider-ca.pem` and mount its CA bundle as below. If TLS fails, fix the certificate; never turn verification off to get past it.
- A login that owns the database, so the boot migrations can create the application and queue schemas.
- Room for 12 connections from this instance, plus administration and provider reservations; see the budget under [Store the connection string](#store-the-connection-string).

[Provider notes](managed-postgres-notes.md) lists what this means on Neon, Supabase and Amazon RDS.

### Hosted database over the internet

1. Create a project or database on Postgres 17, in the region closest to the server.
2. In its connection dialog, choose the direct connection, or session pooling if direct is IPv6-only and your containers have no IPv6 route. Turn transaction pooling off.
3. Copy the connection string. Replace any password placeholder, percent-encoding reserved characters such as `&`, `#`, `?`, `@`, `/` or a space. Replace whatever `sslmode` it shows with `sslmode=verify-full`, and drop parameters such as `channel_binding` that the driver ignores.
4. If the provider supplies its own CA certificate, download it, create the folder on the server, and copy the certificate there from your computer:

   ```sh
   # on the server, in ~/deploy/mergebrief
   mkdir -p secrets
   chmod 700 secrets
   # on your computer
   scp <downloaded-ca-file> <login-user>@<server-public-ipv4>:~/deploy/mergebrief/secrets/provider-ca.pem
   # on the server: a CA certificate is public, and the containers read it as UID 1000
   chmod 644 secrets/provider-ca.pem
   ```

   Then append `&sslrootcert=/etc/ssl/certs/provider-ca.pem` to the connection string.
5. If the plan offers an IP allowlist, restrict the database to the server's address.

A finished string looks like:

```text
postgresql://<user>:<url-encoded-password>@<db-host>:5432/<database>?sslmode=verify-full
```

### Private database in the same cloud

For a cloud VM with its provider's managed Postgres:

1. Create the database in the same region and virtual network as the VM, with public access off, single instance, automated backups on, and storage encryption on. A dev/test template avoids paid high-availability defaults.
2. Admit TCP 5432 to the database only from the VM's security group, never from an address range on the internet. Many consoles offer to connect the database to a compute instance, which builds this for you.
3. Use the database's DNS endpoint, never a resolved IP, so hostname verification and failover keep working.
4. On the server, from `~/deploy/mergebrief`, download the provider's CA bundle for your region:

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   curl --fail --show-error --silent --output secrets/provider-ca.pem <ca-bundle-url>
   chmod 644 secrets/provider-ca.pem
   ```

5. Generate the app login's password with `openssl rand -hex 24` and save it in your password manager.
6. The database is private, so open `psql` as the administrator from the server, with Docker supplying the client. Connecting at all proves the network rules and TLS:

   ```sh
   sudo docker run --rm -it \
     -v "$PWD/secrets/provider-ca.pem:/ca.pem:ro" \
     postgres:17-alpine \
     psql "host=<db-endpoint> port=5432 dbname=postgres user=<admin-user> sslmode=verify-full sslrootcert=/ca.pem"
   ```

7. Create the login and the database it owns. `\password` prompts for the password from step 5 and keeps it out of the server's logs:

   ```sql
   CREATE ROLE mergebrief_app LOGIN;
   \password mergebrief_app
   GRANT mergebrief_app TO CURRENT_USER;
   CREATE DATABASE mergebrief OWNER mergebrief_app;
   \q
   ```

   Managed administrators are usually not superusers. On Postgres 16 and newer such a user must be a member of a role to make it an owner, so without the `GRANT` the last statement answers `must be able to SET ROLE`.

The finished string:

```text
postgresql://mergebrief_app:<hex-password>@<db-endpoint>:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

A security-group rule is network admission, not a Postgres login: the connection still needs credentials and verified TLS. Do not put a short-lived IAM authentication token in the connection string; MergeBrief reads a static DSN and does not refresh tokens.

### Store the connection string

Run these on the server, from `~/deploy/mergebrief`.

1. Create the file, paste the single line, and save. An editor keeps the password out of your shell history:

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

3. Create `docker-compose.override.yml`. If one already exists, merge these entries into it. Without a provider CA:

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

   With a provider CA, also mount it into both services:

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

The overlay removes the bundled `postgres` service, so the `POSTGRES_*` settings no longer apply. `COMPOSE_FILE` lists the override because setting it turns off the automatic override load. Compose file-backed secrets are mounted files, not an encrypted vault, so keep the `secrets` folder private.

A pool max of 3 suits a small instance. With one API, one worker, and large concurrency 1, the pool budget is 12 connections: `3 + (2 * 3 + 1 + 2)`. Leave capacity for migrations, administration and provider reservations, and raise the pool size only within the database's limit.

The app login applies migrations at startup, so it needs DDL permissions. For separate migration and runtime roles, follow the [restricted-role migration instructions](compose.md#restricted-database-roles-mergebrief_auto_migratefalse) instead. Setting `MERGEBRIEF_AUTO_MIGRATE=false` alone does not initialize a database.

### Moving a bundled-Postgres server to managed Postgres

Stop the running stack **before** you change `.env`. Once `COMPOSE_FILE` is set, Compose no longer knows the `postgres` service:

```sh
sudo docker compose down
```

Never add `-v`: that deletes the Postgres volume. A bundled-Postgres folder installed from a release holds no external-database overlay. Download it from the release this instance runs: the first command prints the version `docker-compose.yml` pins, and a pin of `0.1.0` is `v0.1.0` in the URL. A source build skips this step, because its checkout already holds the file.

```sh
grep 'image: ghcr.io/idan91/mergebrief' docker-compose.yml
curl -fsSLo docker-compose.external-db.yml https://github.com/Idan91/mergebrief/releases/download/v0.1.0/docker-compose.external-db.yml
```

Then set up the database and [store the connection string](#store-the-connection-string), merging the override with the one you have.

Data does not move. The new database starts empty, so everyone signs in again and each pull request gets its next brief on its next push. Keep the same hostname and GitHub App only while the old stack stays stopped.

To switch back, run `down` again, remove `COMPOSE_FILE` and `DATABASE_URL_FILE` from `.env`, take the database entries out of the override, and start the stack with the section 5A commands.

## 6. Verify the deployment

```sh
sudo docker compose ps -a
curl --fail --show-error https://brief.example.com/healthz
curl --fail --show-error https://brief.example.com/readyz
sudo docker compose logs --tail=80 api worker web
sudo docker compose stats --no-stream
```

Readiness proves the web-to-API-to-database path, not successful generation. The worker has no HTTP health endpoint, and a configuration error can exit with code zero. Check that it remains running and actually consumes work. Avoid `docker compose config` in shared logs: it can print resolved secrets.

Record the image version, server size, database type and version, idle and peak usage, and the result of each test:

- Sign in with GitHub; sign out and back in.
- Open a PR on the installed test repository; inspect a successful signed webhook delivery and a generated brief.
- Confirm the App posted its Entry comment on that PR. A missing comment does not fail the generation, so a successful brief does not prove this.
- Push another commit and verify the new head's brief appears.
- Submit a review from MergeBrief and verify its author and content on GitHub.
- Restart the worker during generation and confirm the job eventually recovers without a permanently stuck run. Watch provider spend during retries.
- Restart the stack and reboot the server; confirm persistence and readiness.
- For managed Postgres, confirm verified TLS (below).
- Back up and restore into an isolated fresh database, then point an isolated instance at it. Do not send duplicate webhooks or run two workers against production data while validating the restore.

For bundled Postgres, use the [pg_dump and restore procedure](operations.md#backup) and keep encrypted backups off the server. For managed Postgres, enable and test the plan's snapshot or point-in-time recovery. Back up instance secrets separately, particularly `SESSION_KEY_V1`. A disk snapshot alone is not proof of a consistent live Postgres backup.

To confirm TLS on managed Postgres, connect as an administrator while the stack runs, through the provider's SQL console or the `psql` command in [Private database in the same cloud](#private-database-in-the-same-cloud), and check that every row shows `ssl` as `t`:

```sql
SELECT a.usename, s.ssl, s.version
FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
WHERE a.usename = '<app-login>';
```

For a private database, also confirm from your own computer that `dig +short <db-endpoint>` resolves to a private address, such as `10.x.x.x` or `172.31.x.x`.

## 7. Upgrade to a new release

Follow [upgrading to a new version](operations.md#upgrading-to-a-new-version). It covers the backup, the replacement Compose file, the external-database variant and rollback. Repeat the section 6 checks afterwards.

Its commands run bare `docker`. On a server set up by this guide, run them as written from a root shell, in the folder section 3 created. That folder sits under the home of the account that ran section 3, such as `/root` or `/home/ubuntu`:

```sh
sudo -s
cd ~<login-user>/deploy/mergebrief
```

Do not put `sudo` in front of each line instead. `sudo` drops variables set before a command, and one of the upgrade commands passes the database connection string that way. Leave the root shell with `exit` when the upgrade is done.

## Troubleshooting and cleanup

| Symptom | First check |
| --- | --- |
| HTTPS 502 | Caddy upstream and web container startup |
| SSH hangs | Your public IP changed; update the firewall's SSH rule |
| Readiness fails | API logs, database DNS, routing and firewall, TLS CA and credentials |
| Database rejects the SSL mode | Replace `require` with `verify-full`; mount the right CA |
| Permission denied reading a secret | The mounted file exists and UID 1000 can read it |
| API or worker exits 0, log says `config file: not readable (EACCES)` | `chmod 644 mergebrief.config.yaml`, then restart both |
| Brief generates but no Entry comment on the PR | Worker log 403: [Pull requests write missing or not accepted](troubleshooting.md#no-entry-comment-appears) |
| Login does not persist | HTTPS, exact `PUBLIC_BASE_URL` and GitHub callback |
| Worker exited but the Compose command succeeded | Worker configuration error in logs |
| Webhook succeeds but no brief | Installation, author trigger policy, model key, worker logs |
| Managed database times out | IP allowlist, IPv6 route from the containers, private network and security-group admission |
| `CREATE DATABASE` answers `must be able to SET ROLE` | Run the `GRANT` in [Private database in the same cloud](#private-database-in-the-same-cloud) first |
| API or worker logs `unable to verify the first certificate` | The DSN's `sslrootcert`, and that the bundle matches the database's provider and region |
| Too many database connections | All pools and replicas, provider reservations and pool limits |

To retire an instance, disable its GitHub webhook and App installation, save any needed data and secrets, stop Compose, and delete the intended resources. Review each one explicitly: server disks, snapshots, reserved public IPs, managed databases and their network rules, backup retention, and DNS. A reserved IP and a managed database usually keep billing after the server is gone. Only delete volumes once data is no longer needed. Rotate or revoke credentials only that instance used.

## Appendix: source builds for contributors

This path is for working on MergeBrief and testing unpublished changes. It is not an installation or upgrade path: a source build reports version `dev`, never checks for releases, and is not a published release. It needs `git` and Docker Buildx on the server, and an image build may need more memory than running the application.

### Build current main

Replace section 3 with a fresh checkout, authenticated through your normal repository access if the repository is private. Do not embed a GitHub token in the clone URL. Substitute the repository URL you have access to:

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

Record the full SHA with your test results: it fixes the build to the main commit fetched at that moment. Do not run `git pull` while testing; move to a newer commit deliberately with [the steps below](#move-a-source-build-to-a-newer-commit).

Follow sections 4 and 5 from the checkout, with one change. Wherever they run `sudo docker compose pull` and `sudo docker compose up -d --wait`, build instead:

```sh
sudo docker pull postgres:17-alpine
sudo docker compose build
sudo docker compose up -d --wait --pull never
```

The build uses the selected checkout, and `--pull never` stops Compose from replacing it with a registry image. The explicit Postgres pull supplies the database image on a fresh host; skip it on managed Postgres.

### Move a source build to a newer commit

Back up first if the instance holds data you want to keep ([backup](operations.md#backup)). API and worker apply new migrations when they start. From the checkout:

```sh
git fetch origin main
git checkout --detach origin/main
git rev-parse HEAD
sudo docker compose build
sudo docker compose up -d --wait --pull never
```

Record the new SHA with your results, then repeat the section 6 checks. A release installation upgrades through [operations](operations.md#upgrading-to-a-new-version) instead.
