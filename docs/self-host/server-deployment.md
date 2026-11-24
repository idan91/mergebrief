# Deploy on a server

This guide runs a pinned MergeBrief release on a fresh Ubuntu 24.04 LTS server with a real domain, from creating the server to a brief on a real pull request. It works on any provider: it states what the server and database need, not which buttons a console shows. Replace `brief.example.com` and every `<placeholder>` before you run a command.

## Choose the deployment

Answer two questions. Every other step is the same whatever you pick.

**1. What runs MergeBrief?**

| Server | What it is | Pick it when |
| --- | --- | --- |
| VPS | A rented server with a public IP, such as Hetzner, DigitalOcean or Linode | You want the simplest and cheapest setup |
| Cloud VM | An instance in a cloud account, such as AWS EC2, Google Compute Engine or an Azure VM | You want the database on a private network next to it |

**2. Where does Postgres run?**

| Database | What it is | Works with | Steps |
| --- | --- | --- | --- |
| On the server | The Postgres container the Compose file ships | Any server | [5A](#5a-database-on-the-server) |
| Managed, over the internet | A hosted Postgres you reach with verified TLS, such as Neon or Supabase | Any server | [5B](#database-over-the-internet) |
| Managed, private | The cloud's own Postgres on the VM's private network, such as Amazon RDS | A cloud VM in the same account | [5B](#private-database-in-the-same-cloud) |

Start with a VPS and the database on the server unless you need a managed database's backups.

A VPS with the database on the server, and a VPS with Neon, have been run end to end. Supabase and the private managed database follow the providers' documentation and have not been run end to end yet.

Give each instance its own database, hostname and GitHub App. Two instances on one database would consume the same jobs. Changing `DATABASE_URL` copies no data; moving a deployment is a backup and restore ([Restore to a new host](backup-restore.md#restore-to-a-new-host)).

Start the server at 2 vCPU, 4 GB RAM and 40 GB SSD, with one api and one worker. That is a starting point, not a measured minimum.

## 1. Provision the server

Create one server with these settings. Console wording differs by provider; pick the nearest option.

| Setting | Pick for a first deployment | Reason |
| --- | --- | --- |
| Image | **Ubuntu 24.04 LTS**, x86-64, the plain OS image | Matches this guide. The console may default to a newer release. Docker is installed below. |
| Size | At least **2 vCPU, 4 GB RAM, 40 GB SSD** | Shared vCPUs are enough at this size. |
| Location | The one nearest your reviewers and, for a managed database, the database | Every api and worker query crosses the link to the database. |
| Public IPv4 | On, and static | DNS points at it. On a cloud VM, a default public IP changes when the instance stops: reserve a static address and associate it. |
| Public IPv6 | Optional | Helps reach an IPv6-only database endpoint, but the containers need their own IPv6 route too (see DNS below). |
| SSH key | Your public key, added at creation | Avoids an emailed root password. See below. |
| Firewall | Attached at creation, with the rules below | A VPS firewall and a cloud security group do the same job here. |
| Disk | Encrypted if offered; no extra volume | The Postgres volume lives on the included disk. |
| Instance identity | On a cloud VM: token-only metadata access, no instance role | MergeBrief needs no cloud credentials. |
| Startup script (cloud-init, user data) | **Leave blank** | Follow the manual installation below. Do not paste application secrets here. |
| Backups | **Off for a disposable first deployment**; on once it holds data you keep | Server backups supplement, rather than replace, database backups (section 8). |

Read the price in the console's final summary. A managed database, a reserved IP and model usage are separate charges.

### Add an SSH key

If you already have a suitable SSH key, give the provider its **public** `.pub` file. Otherwise, run these on your own computer, not on the server. Use a new filename and do not overwrite an existing key:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mergebrief -C "mergebrief-admin"
cat ~/.ssh/mergebrief.pub
```

Choose a passphrase when prompted, and paste the printed line into the provider's SSH key field. Never upload the file without `.pub`: that is the private key. If the provider generates the key pair instead, move the downloaded private key into `~/.ssh/` and run `chmod 400` on it.

After creating the server, connect with the login your image uses, `root` on most VPS images and `ubuntu` on most cloud Ubuntu images:

```sh
ssh -i ~/.ssh/mergebrief <login>@<server-public-ipv4>
```

Verify the host key fingerprint through the provider's web console before accepting it on first connection. Create a named administrator for ongoing access after setup. Later commands write `<login>@<server-public-ipv4>` for this address.

### Firewall

Allow these inbound rules and nothing else:

| Protocol / port | Source | Purpose |
| --- | --- | --- |
| TCP 22 | Your current public IPv4 with `/32`; optionally your administrator IPv6 with `/128` | SSH |
| TCP 80 | Any IPv4 (`0.0.0.0/0`) and any IPv6 (`::/0`) | HTTP redirects and certificate validation |
| TCP 443 | Any IPv4 (`0.0.0.0/0`) and any IPv6 (`::/0`) | The application, GitHub login callbacks and webhooks |
| ICMP | Any IPv4 and IPv6, optional | Diagnostics and network error signaling; it grants no terminal access |

Find your public IPv4 for the SSH rule by running this in a terminal on your own computer, not on the server, on the network and VPN you will use for SSH:

```sh
curl -4 https://icanhazip.com
```

If it prints `203.0.113.10`, you enter `203.0.113.10/32`: "allow this exact IPv4 address." Do not use your computer's local `192.168.*` address or the server's IP. Some consoles offer **My IP**, which fills in the same value.

- **If your public IP changes** after switching Wi-Fi, reconnecting your router or changing VPN, SSH hangs. Run the `curl` command again and update the SSH rule in the provider's console.
- **Do not add inbound 3000, 3001 or 5432**, even for a managed database: that is an outbound connection the application opens.
- **Leave outbound traffic unrestricted** for a first deployment: it carries package downloads, DNS, GitHub and model HTTPS, and the database connection.
- **Confirm the firewall is attached to the server.** A firewall that exists but is not applied protects nothing.

### DNS

Point `brief.example.com`'s A record at the server's static public IPv4. Add an AAAA record only after testing inbound IPv6. Having IPv6 enabled does not require publishing AAAA. Docker containers also need working outbound IPv6 before they can use an IPv6-only database endpoint; host connectivity alone does not establish this. Continue with section 2.

## 2. Install Docker and HTTPS

Install Docker Engine and the Compose plugin using the [official Ubuntu apt-repository instructions](https://docs.docker.com/engine/install/ubuntu/). Use Compose v2.24.4 or newer. Install Caddy using its [official Ubuntu package instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian). Use a maintained system service for both:

```sh
sudo systemctl enable --now docker
sudo systemctl enable --now caddy
sudo docker compose version
```

The commands below use `sudo docker`; membership in the docker group is root-equivalent and is not required. Install `curl` and `openssl` if missing. Apply Ubuntu security updates before opening the application. Docker-published ports can bypass UFW, so keep the shipped loopback bindings and enforce the provider firewall too.

Once DNS points at this host, write the Caddyfile and reload Caddy with steps 3 and 4 of [Put HTTPS in front on a server](compose.md#put-https-in-front-on-a-server), and run its check. Caddy obtains and renews the certificate; the application stays HTTP on loopback. Do not put browser authentication in front of the GitHub webhook route. Before sustained public use, apply the webhook rate-limit guidance in [Compose hardening](compose.md#hardening-before-real-exposure): standard Caddy does not include a rate limiter.

## 3. Select an exact application version

The host holds one folder, with no checkout of the repository and no build. Make its parent, and keep new files private to you for the rest of this shell:

```sh
mkdir -p ~/deploy && cd ~/deploy
umask 077
```

Then run [Get the release files](compose.md#get-the-release-files) from there, with its check. It creates `~/deploy/mergebrief`, where every later command runs.

For a managed database, also fetch the overlay of the same release: the `curl` step of [External Postgres](compose.md#external-postgres-managed-database). Section 5B names it in `COMPOSE_FILE`.

Do not edit the Compose files: an upgrade replaces them byte for byte. Your own settings go in `.env` and `docker-compose.override.yml`. Finish sections 4 and 5 before starting the services.

Contributors testing unpublished changes build from source instead: see the [appendix](#appendix-source-builds-for-contributors).

## 4. Configure GitHub, sessions and model access

Register the GitHub App with `https://brief.example.com` as its origin, following [github-app.md](github-app.md) through [Install the App](github-app.md#install-the-app). Install it on a test repository. Keep the webhook secret you generated there and entered in the App's **Webhook secret** field: `.env` needs the same value. Deliveries fail until the stack runs; you redeliver one in section 6.

Fill in `.env` on the server with an editor, following [Fill in `.env`](compose.md#fill-in-env): it has the commands, the filled-in block with `POSTGRES_PASSWORD`, and what each value must look like. On a server:

- **Generate the secrets in a trusted terminal,** and keep the output out of shared terminal recordings, issues, logs and command arguments. Keep the session key in your secret backup too: after a database restore, the reviewer credentials stored in the database can only be read with the same key.
- **The private key is on your own computer.** Open the `.pem` file there and paste its contents, BEGIN and END lines included, inside the single quotes, or copy the file over as below.
- **With a managed database,** leave `POSTGRES_PASSWORD` out: the overlay removes the bundled Postgres.
- **Another model provider** needs its block in the config file ([generators.md](generators.md)), not only a different key.

### Use a key file instead of the inline key

Follow [Use a key file instead of the inline key](compose.md#use-a-key-file-instead-of-the-inline-key), with two differences on a server:

- **The `scp` target** is `<login>@<server-public-ipv4>:~/deploy/mergebrief/secrets/github-app.pem`, with the `-i` key you connect with.
- **With a managed database,** merge the override entries into the one you create in section 5B.

### List who may sign in

An instance starts closed: nobody can sign in until its config names them. Print your GitHub user id, on any machine with the `gh` CLI ([who may start a brief](security-model.md#who-can-sign-in)):

```sh
gh api users/<your-login> --jq .id
```

On the server, copy the example config and open it up to the containers' UID 1000: the `umask 077` from section 3 still applies in this shell, so a config file created here is unreadable by them. It holds variable names, not keys. Then replace the placeholder under `operators` with that id:

```sh
cp mergebrief.config.example.yaml mergebrief.config.yaml
chmod 644 mergebrief.config.yaml
```

```yaml
operators:
  - 583231
```

That covers repositories on your own account. If the test repository belongs to an organization, list the organization too, or its pushes start nothing. Print its id:

```sh
gh api orgs/<org> --jq .id
```

```yaml
allowed:
  accounts:
    - 12345678
```

`docker-compose.yml` mounts the file read-only into `api` and `worker` and sets `MERGEBRIEF_CONFIG` for both. The image does not contain your config, and Compose refuses to start either service while the file is missing.

For a first deployment, also choose a low daily generation cap in that file ([Set the cap](spend-cap.md#set-the-cap)). This limits generation count, not token dollars; also use the model provider's spending controls.

## 5A. Database on the server

Before the first boot, check that `.env` sets `POSTGRES_PASSWORD`, as [Fill in `.env`](compose.md#fill-in-env) does:

```sh
grep -c '^POSTGRES_PASSWORD=' .env
```

It prints `1`. Leave `COMPOSE_FILE`, `DATABASE_URL` and `DATABASE_URL_FILE` unset: the shipped Compose file derives the internal connection string. Changing the password later in `.env` does not change it in an already initialized Postgres ([Postgres credentials](compose.md#1-postgres-credentials)).

Run from `~/deploy/mergebrief`:

```sh
sudo docker compose pull
sudo docker compose up -d --wait
sudo docker compose ps -a
```

`pull` fetches the image the release's Compose file pins, and Postgres with it.

Only `web` is reachable, through Caddy. Postgres's host port stays on loopback; `api` is only on the Compose network. Postgres data lives in its named volume. Never use `docker compose down -v` unless you mean to delete the instance's data.

## 5B. Managed database

### What the database must provide

- **PostgreSQL 16 or newer**, preferably 17 to match the bundled one.
- **A separate database or project for this instance**, in a region near the server. `api` and `worker` use the same database; the browser and `web` need no database credentials.
- **A direct or session-mode connection, never a transaction pooler.** The worker holds `LISTEN`/`NOTIFY` sessions and the boot migrations take a session advisory lock. A provider's REST API does not replace Postgres.
- **Verified TLS.** The connection string ends in `sslmode=verify-full`; MergeBrief refuses `require` at boot. If the provider's certificate does not chain to a public root, the string also names a CA file, `sslrootcert=/etc/ssl/certs/provider-ca.pem`. If TLS fails, fix the certificate. Never turn verification off to get past it.
- **A login that owns the database**, so the boot migrations can create the application and queue schemas.
- **Room for 12 connections** from this instance, plus administration and provider reservations ([pool budget](#store-the-connection-string)).

Set it up as a [database over the internet](#database-over-the-internet) or a [private database in the same cloud](#private-database-in-the-same-cloud), check [your provider's specifics](#provider-specifics), then [store the connection string](#store-the-connection-string).

### Database over the internet

1. Create a project or database on Postgres 17, in the region closest to your server. If the console offers a coding-agent prompt, wire it yourself: MergeBrief needs only the connection string. Keep the default role when it owns the database.
2. In its connection dialog, choose the **direct** connection with pooling off. If direct is IPv6-only and your containers have no IPv6 route, choose **session** pooling instead. Never transaction pooling.
3. Copy the connection string and replace the password placeholder. Percent-encode any reserved character in the password, such as `&`, `#`, `?`, `@`, `/` or a space. Keep the host and username as shown.
4. Replace whatever `sslmode` the string ends with by `sslmode=verify-full`, and drop `channel_binding` if present: the database driver ignores it.
5. If the provider supplies its own CA certificate, download it and copy it to the server. On the server, from `~/deploy/mergebrief`:

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   ```

   On your computer:

   ```sh
   scp <downloaded-ca-file> <login>@<server-public-ipv4>:~/deploy/mergebrief/secrets/provider-ca.pem
   ```

   On the server, let the containers read it. A CA certificate is public:

   ```sh
   chmod 644 secrets/provider-ca.pem
   ```

   Then append `&sslrootcert=/etc/ssl/certs/provider-ca.pem` to the connection string.
6. If your plan offers an IP allowlist, restrict the database to the server's address.

The finished string looks like this, with `&sslrootcert=/etc/ssl/certs/provider-ca.pem` after it when the provider has its own CA:

```text
postgresql://<user>:<url-encoded-password>@<database-host>:5432/<database>?sslmode=verify-full
```

### Private database in the same cloud

The `psql` steps, the migrations and the TLS check below were rehearsed on Postgres 17 with a non-superuser admin, a TLS-only server and a private CA bundle. They have not been run end to end on a cloud provider yet.

1. Create the database in the same region and virtual network as the cloud VM: **public access off**, a single instance, Postgres 17, automated backups on, storage encryption on, no initial database name (step 6 creates it). A dev/test template avoids paid high-availability defaults.
2. Admit TCP 5432 to the database **only from the VM's security group**, never from an address range. Many consoles offer to connect the database to a compute instance, which builds this rule, and the private subnets if the network has none.
3. Wait until the database is available and copy its **endpoint**. Use this DNS name, never a resolved IP, so hostname verification and failover keep working.
4. On the server, from `~/deploy/mergebrief`, download the provider's CA bundle for the database's region. The `chmod` matters: the `umask 077` from section 3 leaves the file private, and the containers read it as UID 1000. A CA certificate is public.

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   curl --fail --show-error --silent \
     --output secrets/provider-ca.pem \
     <ca-bundle-url>
   chmod 644 secrets/provider-ca.pem
   ```

5. Generate the app login's password and save it in your password manager. Hex needs no percent-encoding in a connection string:

   ```sh
   openssl rand -hex 24
   ```

6. Open `psql` as the database's administrator. The database is private, so this has to run on the server, and Docker supplies the client. Connecting at all proves the security groups and TLS. It prompts for the administrator's password:

   ```sh
   sudo docker run --rm -it \
     -v "$PWD/secrets/provider-ca.pem:/ca.pem:ro" \
     postgres:17-alpine \
     psql "host=<database-endpoint> port=5432 dbname=postgres user=<admin-user> sslmode=verify-full sslrootcert=/ca.pem"
   ```

7. Create the login and the database it owns. `\password` prompts for the password from step 5, which keeps it out of the server's logs:

   ```sql
   CREATE ROLE mergebrief_app LOGIN;
   \password mergebrief_app
   GRANT mergebrief_app TO CURRENT_USER;
   CREATE DATABASE mergebrief OWNER mergebrief_app;
   \q
   ```

   The `GRANT` is required. A managed database's administrator is usually not a superuser, and on Postgres 16 and newer it must be a member of a role to make it an owner ([`createrole_self_grant`](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)); otherwise the last statement answers `must be able to SET ROLE`. As owner, `mergebrief_app` can create the application and queue schemas, and it holds no administration of the database service.

The finished string looks like this:

```text
postgresql://mergebrief_app:<hex-password>@<database-endpoint>:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

`/etc/ssl/certs/provider-ca.pem` is the path inside the containers, where the override below mounts the bundle.

- The security group admits the VM on the network; the connection still needs the login and verified TLS. Keep the provider's force-TLS setting on.
- Do not put a short-lived IAM authentication token in the DSN: nothing refreshes it.

### Provider specifics

What the steps above mean on the providers this guide has been checked against.

| Provider | Path | Connection to pick | CA file |
| --- | --- | --- | --- |
| Neon | Over the internet | Direct: pooling off, no `-pooler` in the host | None: the chain ends in a public root (ISRG Root X1) |
| Supabase | Over the internet | **Session pooler**, port 5432 | The project's CA certificate |
| Amazon RDS | Private, from EC2 | The instance endpoint, from the same VPC | The region bundle |

#### Neon

- Run end to end once, from a VPS.
- Neon's pooler runs in transaction mode, which [does not support](https://neon.com/docs/connect/connection-pooling) `LISTEN`/`NOTIFY` or session advisory locks. With **Connection pooling** off, the hostname has no `-pooler`.
- Neon shows `?sslmode=require&channel_binding=require`; use `?sslmode=verify-full` instead.
- The Free plan gives 100 CU-hours a month, about 16 days of continuous running at 0.25 CU. The worker polls its queue every 2 seconds, so expect the compute not to scale to zero and the allowance to drain around the clock; this is not yet measured. When it runs out, Neon suspends the compute until the next billing period and the app loses its database. Keep the compute at 0.25 CU for a first deployment.

#### Supabase

- Follows Supabase's [connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres); not run end to end yet.
- The direct connection is IPv6 only without the paid IPv4 add-on, and Compose containers have no IPv6 route by default, so use the **Session pooler**. Keep its host and `postgres.<project-ref>` username. The transaction pooler drops the session state the worker relies on.
- The CA certificate is under the project's **Database Settings → SSL Configuration**.
- The session pooler holds one database connection per client, and the Free plan's default pool size is 15. `DATABASE_POOL_MAX=3` needs up to 12, so leave it at 3. Session mode is the least proven path: in [section 6](#6-check-the-stack-end-to-end), confirm that a push actually produces a brief.

#### Amazon RDS

- Follows AWS's documentation; not run end to end on RDS yet.
- Create with **Standard create** and the **Dev/Test** or **Sandbox** template, never **Production**, which preselects Multi-AZ and paid IOPS storage. **db.t4g.micro** with 20 GiB gp3 is enough for a first deployment. Master username `postgres`, credentials **Self managed**.
- **Connect to an EC2 compute resource**, with your instance, does the private networking: RDS sets **Public access: No**, picks or creates a DB subnet group with private subnets only, and adds `rds-ec2-n` on the database and `ec2-rds-n` on the instance. A default VPC has no private subnets, so without this option you build them yourself. Do not edit these groups afterwards: RDS reuses them only if they stay unmodified.
- The CA bundle URL is `https://truststore.pki.rds.amazonaws.com/<region>/<region>-bundle.pem`, such as `eu-central-1`; [AWS's list](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html#UsingWithRDS.SSL.CertificatesAllRegions) has every bundle. Leave the default certificate authority, `rds-ca-rsa2048-g1`: it is in every regional bundle. Keep `rds.force_ssl` on, the default on RDS PostgreSQL 15 and newer ([RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)).
- The RDS master user is not a superuser, which is why the `GRANT` is required.
- Sources: [security groups for an application server](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html), [automatic EC2 connectivity](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html#USER_CreateDBInstance.Prerequisites.VPC.Automatic).

### Store the connection string

Run these on the server, from `~/deploy/mergebrief`.

1. Create the file. Paste the single line, then save. Typing it into an editor keeps the password out of your shell history:

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

3. Create `docker-compose.override.yml`. If one already exists, merge these entries into it instead of replacing it.

   With a public certificate, no CA file:

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

   With a provider CA:

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

A pool max of 3 suits a small instance. With one api, one worker, and large concurrency 1, the pool budget is 12 connections: `3 + (2 * 3 + 1 + 2)`. Leave room for migrations, administration and provider reservations, and raise the pool size only within the database's limit.

The app login applies migrations at startup, so it needs DDL permissions. For separate migration and runtime roles, follow the [restricted-role migration instructions](compose.md#restricted-database-roles-mergebrief_auto_migratefalse) instead. Setting `MERGEBRIEF_AUTO_MIGRATE=false` alone does not initialize a database.

### Move an existing server to a managed database

To move a running server with the database on the server instead of starting a new one, stop it **before** you change `.env`. Once `COMPOSE_FILE` is set, Compose no longer knows the `postgres` service:

```sh
sudo docker compose down
```

Never add `-v`: that deletes the Postgres volume. A folder installed with the database on the server holds no external-database overlay, because section 3 fetches it only for a managed database. Fetch it now with the `curl` step of [External Postgres](compose.md#external-postgres-managed-database), which reads the release this instance runs from `docker-compose.yml`. A source build skips this step, because its checkout already holds the file.

Then set up the database and [store the connection string](#store-the-connection-string), merging the override with the one you have.

Data does not move. The new database starts empty, so everyone signs in again and each pull request gets its next brief on its next push. Keep the same hostname and GitHub App only while the old stack stays stopped.

To switch back, run `down` again, remove `COMPOSE_FILE` and `DATABASE_URL_FILE` from `.env`, take the database entries out of the override, and start the stack with the section 5A commands.

## 6. Check the stack end to end

Run these from `~/deploy/mergebrief`, in order. Each step says what you should see.

1. **The services are up.**

   ```sh
   sudo docker compose ps -a
   ```

   `api` and `web` show `healthy` and `worker` shows `Up`; with the database on the server, `postgres` shows `healthy` too. The worker has no health check, and a configuration error exits 0, so read its state here: `Exited (0)` means `sudo docker compose logs worker` ends with the reason.

2. **HTTPS reaches the database.**

   ```sh
   curl --fail --show-error https://brief.example.com/healthz
   curl --fail --show-error https://brief.example.com/readyz
   ```

   Both succeed. `/healthz` proves Caddy and `web`; `/readyz` proves `web` to `api` to the database. On a managed database it also proves verified TLS: with `sslmode=verify-full`, the api cannot reach a database whose certificate does not verify. A `502` is Caddy with no `web` behind it yet.

3. **The logs are clean.**

   ```sh
   sudo docker compose logs --tail=80 api worker web
   ```

   No `"level":"error"` lines. Do not paste `docker compose config` output anywhere shared: it prints resolved secrets.

4. **GitHub's deliveries arrive.** In the App's settings, open **Advanced**, open the newest delivery under **Recent Deliveries**, click **Redeliver**, and confirm. It answers `200`. A `401` means `GITHUB_WEBHOOK_SECRET` in `.env` differs from the App's **Webhook secret** ([Webhook deliveries answer 401](troubleshooting.md#webhook-deliveries-answer-401)). With no delivery listed, check on the **General** tab under **Webhook** that **Active** is checked and **Webhook URL** is `https://brief.example.com/api/webhooks/github`.
5. **Sign-in works.** Open `https://brief.example.com`, sign in with GitHub, sign out, and sign in again.
6. **A pull request gets a brief.** Open a pull request on the test repository while you watch the worker:

   ```sh
   sudo docker compose logs -f worker
   ```

   About a minute later the App comments on the pull request. When the brief is ready the comment reads **Read the brief for this push**, and its link opens the brief. A brief whose pull request has no comment: [No Entry comment appears](troubleshooting.md#no-entry-comment-appears).

7. **A second push gets its own brief.** Push another commit. The comment is replaced for the new head, and its brief opens.
8. **A review reaches GitHub as you.** Submit a review from MergeBrief. On GitHub, it shows your account as its author.
9. **Private database only: TLS and privacy.** Repeat the `psql` command from [step 6](#private-database-in-the-same-cloud) while the stack runs. Every row shows `ssl` as `t`:

   ```sql
   SELECT a.usename, s.ssl, s.version
   FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
   WHERE a.usename = 'mergebrief_app';
   ```

   Then, on your own computer, confirm the database is private. The answer is a private address, such as `10.x.x.x` or `172.31.x.x`:

   ```sh
   dig +short <database-endpoint>
   ```

Optionally, test recovery: run `sudo docker compose restart worker` while a brief generates, and confirm the run finishes after the restart rather than staying stuck. Watch the provider's spend while it retries.

## 7. Start on boot

A reboot leaves the stack down: `restart: on-failure` does not bring services back when Docker starts, and `postgres` has no restart policy. Install the systemd unit from [Start on boot](compose.md#start-on-boot), running its commands from the instance folder so `WorkingDirectory` gets this folder's path:

```sh
cd ~/deploy/mergebrief
```

**Check:** `systemctl cat mergebrief | grep WorkingDirectory` shows the folder under your login's home, such as `/root/deploy/mergebrief` or `/home/ubuntu/deploy/mergebrief`. Then reboot:

```sh
sudo reboot
```

Reconnect, and from `~/deploy/mergebrief` repeat checks 1 and 2 from [section 6](#6-check-the-stack-end-to-end). Deliveries GitHub sent while the server was down are resent by the worker within about 30 minutes, or redeliver one from the App's **Advanced** tab.

## 8. Back up the instance

Back up the database and the files that unlock it, and keep both off the server.

- **The database on the server.** Dump it, then copy the dump to your own computer:

  ```sh
  sudo docker compose exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
    > mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
  ```

  ```sh
  scp <login>@<server-public-ipv4>:~/deploy/mergebrief/mergebrief-*.dump .
  ```

  Scheduling and restore are in [backup-restore.md](backup-restore.md#schedule-backups). A server disk snapshot alone is not a consistent Postgres backup.

- **A managed database.** The provider's snapshots or point-in-time recovery are the backup. Turn them on for your plan and test a restore.
- **Every deployment: the instance's own files.** Copy `.env`, `mergebrief.config.yaml`, and `docker-compose.override.yml` and `secrets/` if you have them, into your password manager or an encrypted store. A restored database needs the same `SESSION_KEY_V1` to read the reviewer tokens it holds.

Prove a backup by restoring it into an isolated fresh database and pointing an isolated instance at it ([Restore](backup-restore.md#restore-in-place)). Do not run that instance's worker against production data or send it production webhooks.

## 9. Upgrade to a new release

Follow [upgrade.md](upgrade.md). It covers the backup, the replacement Compose file, the external-database variant and rollback. Repeat checks 1 to 3 of [section 6](#6-check-the-stack-end-to-end) afterwards.

Its commands run bare `docker`. On a server set up by this guide, run them as written from a root shell, in the folder section 3 created. That folder sits under the home of the login that ran section 3, such as `/root` or `/home/ubuntu`:

```sh
sudo -s
cd /root/deploy/mergebrief   # or /home/<login>/deploy/mergebrief
```

Do not put `sudo` in front of each line instead. `sudo` drops variables set before a command, and one of the upgrade commands passes the database connection string that way. Leave the root shell with `exit` when the upgrade is done.

## Troubleshooting and cleanup

When a check fails, find what you see in [troubleshooting.md](troubleshooting.md#find-your-symptom). It covers this guide's cases too: a 502 from Caddy, a refused `sslmode`, a CA or secret file the container cannot read, a managed database that times out, `must be able to SET ROLE`, and too many connections.

To retire an instance, follow [uninstall.md](uninstall.md) for GitHub and the host, then delete the provider resources you created. Check server disks, snapshots, reserved public IPs, managed databases and their network rules, backup retention and DNS. A reserved IP and a managed database usually keep billing after the server is gone. Delete volumes only once the data is no longer needed. Rotate or revoke the credentials only that instance used.

## Appendix: source builds for contributors

This path is for working on MergeBrief and testing unpublished changes. It is not an installation or upgrade path: a source build reports version `dev`, never checks for releases, and is not a published release. It needs `git` and Docker Buildx on the server, and an image build may need more memory than running the application.

### Build current main

Replace section 3 with a fresh checkout of the repository or your fork. Do not embed a GitHub token in the clone URL:

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

The build uses the selected checkout, and `--pull never` stops Compose from replacing it with a registry image. The explicit Postgres pull supplies the database image on a fresh host; skip it on a managed database.

### Move a source build to a newer commit

Back up first if the instance holds data you want to keep ([backup](backup-restore.md#back-up-the-bundled-database)). `api` and `worker` apply new migrations when they start. From the checkout:

```sh
git fetch origin main
git checkout --detach origin/main
git rev-parse HEAD
sudo docker compose build
sudo docker compose up -d --wait --pull never
```

Record the new SHA with your results, then repeat the section 6 checks. A release installation upgrades through [upgrade.md](upgrade.md) instead.
