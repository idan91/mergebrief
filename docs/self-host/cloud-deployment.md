# Deploy on a cloud VM (Hetzner, AWS EC2)

This guide runs a pinned MergeBrief release on a fresh Ubuntu 24.04 LTS VM with a real domain, from creating the VM to a brief on a real pull request. Replace `brief.example.com` and every `<placeholder>` before you run a command.

## Choose the deployment

| VM | Database | Pick it when |
| --- | --- | --- |
| Hetzner | Postgres on the same VM | You want the cheapest complete self-host |
| Hetzner | Neon or Supabase | You want a managed database with its own backups |
| AWS EC2 | Postgres on the same instance | You want the same installation inside AWS |
| AWS EC2 | Private RDS PostgreSQL | You want AWS private networking and a managed database |
| AWS EC2 | Neon or Supabase | You want a managed database outside AWS |

The Hetzner deployments have been run end to end, the external-database one on Neon. The Supabase steps and the EC2 deployments follow the providers' documentation and have not been run end to end yet.

Give each instance its own database, hostname and GitHub App. Two instances on one database would consume the same jobs. Changing `DATABASE_URL` copies no data; moving a deployment is a backup and restore ([Restore to a new host](backup-restore.md#restore-to-a-new-host)).

Start the VM at 2 vCPU, 4 GB RAM and 40 GB SSD, with one api and one worker. That is a starting point, not a measured minimum.

## 1. Provision the VM

### Hetzner

Use these choices on Hetzner's **Create a server** screen, whichever database you picked.

| Console section | Pick for a first deployment | Reason |
| --- | --- | --- |
| Type | Check **Cost-Optimized → x86 (Intel/AMD)** for an available size with at least **2 vCPU / 4 GB RAM / 40 GB SSD**. If unavailable, keep **Regular Performance → CPX22** | CPX22 has 2 vCPU, 4 GB RAM and 80 GB SSD, a reasonable starting point. Dedicated General Purpose is unnecessary at this size. |
| Location | The location nearest your reviewers and external database that offers the size | This is a proximity choice, not a measured latency result. |
| Image | **OS Images → Ubuntu → 24.04** using the version dropdown | The console may default to a newer release; select 24.04 to match this guide. Use the plain OS image and install Docker as below. |
| Networking | **Public IPv4 on**, **Public IPv6 on**, **Private networks off** | IPv4 simplifies DNS and SSH; IPv6 can help with direct Supabase access. A Hetzner private network does not connect to Neon, Supabase or RDS. |
| SSH keys | **Add SSH key**, then select your public key | Do this before creation rather than using an emailed root password. See the steps below. |
| Volumes | **None** | The included SSD is enough initially. Docker's named Postgres volume lives on that disk; it is not a separately purchased Hetzner Volume. |
| Firewalls | Create and select **mergebrief-test** with the rules below | Create it before buying the server. |
| Backups | **Off for a disposable first deployment**; enable if keeping useful data or configuration | Backups add to the server price. VM backups supplement, rather than replace, database backups. |
| Placement groups | **None** | A single server does not benefit from distributing servers across physical hosts. |
| Labels | Optional: **app=mergebrief**, **environment=test** | Helps identify and clean up this VM. Leave blank if unnecessary. |
| Cloud config | **Leave blank** | Follow the manual installation below. Do not paste application secrets here. |
| Name | **mergebrief-test** | Identifies the server in the console. |
| Server count | **1** | All three app processes run on this VM. |

Read the price in the console's final summary, which changes with location, type, backups and VAT. The external database and model usage are separate charges.

With the database on the VM, the named Docker volume stores Postgres on the included root disk. With an external database, the provider stores the data. Hetzner's [server backups](https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/) cover the server disk, not separately attached Hetzner Volumes or an external database. Keep the backup steps later in this guide either way.

#### Add the SSH key from your computer

If you already have a suitable SSH key, paste its **public** `.pub` file into **Add SSH key**. Otherwise, run these on your own computer, not on the server. Use a new filename and do not overwrite an existing key:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/mergebrief_hetzner -C "mergebrief-hetzner"
cat ~/.ssh/mergebrief_hetzner.pub
```

Choose a passphrase when prompted. Paste the printed line into Hetzner, name it `mergebrief-admin`, and select it. Never upload the file without `.pub`: that is the private key. After creating the server, connect with:

```sh
ssh -i ~/.ssh/mergebrief_hetzner root@<server-public-ipv4>
```

Replace the placeholder with the address shown by Hetzner. Verify the host key fingerprint through the server console before accepting it on first connection. Create a named administrator for ongoing access after setup.

#### Create and attach the firewall

Open **Firewalls** in another tab and create `mergebrief-test` with these rules:

| Direction | Protocol / port | Source |
| --- | --- | --- |
| Inbound | TCP 22 | Your current public IPv4 with `/32`; optionally your administrator IPv6 with `/128` |
| Inbound | TCP 80 | Any IPv4 (`0.0.0.0/0`) and any IPv6 (`::/0`) |
| Inbound | TCP 443 | Any IPv4 (`0.0.0.0/0`) and any IPv6 (`::/0`) |
| Inbound | ICMP | Any IPv4 and IPv6, for diagnostics and network error signaling |

On Hetzner's **Create Firewall** screen:

1. Find your public IPv4 for the SSH rule. Run this in a terminal on your own computer, not on the Hetzner server, on the same network and with the same VPN connection you will use for SSH: the rule needs the address you connect **from**.

   ```sh
   curl -4 https://icanhazip.com
   ```

   If it prints `203.0.113.10`, you enter `203.0.113.10/32`. Use your actual output, not this example. The `/32` suffix means "allow this exact IPv4 address." Do not use your computer's local `192.168.*` address or the Hetzner server's IP.

2. In the first inbound rule:

   1. Set the description to `SSH from my network`.
   2. Remove **both** source chips: **Any IPv4** and **Any IPv6**.
   3. Enter your public IPv4 with `/32` appended, then press Enter to add it.
   4. Keep **Protocol: TCP** and **Port: 22**. Leave **Port range** empty.

3. Keep the existing **ICMP** rule with **Any IPv4** and **Any IPv6**.
4. Click **Add rule** twice to create separate **TCP 80** and **TCP 443** rules, each with **Any IPv4** and **Any IPv6**. Leave both port-range fields empty; do not create a range from 80 through 443.
5. Leave **Outbound rules** empty for a first deployment. **Labels** can stay blank; set **Name** to `mergebrief-test`.
6. Under **Apply to → Select Resources**, select the MergeBrief server if it already exists. Otherwise, create the firewall, then return to the server creation form and select it (refresh if necessary).
7. Confirm the firewall is attached to the server: creating a firewall without applying it does not protect the server.

- **If your public IP changes** after switching Wi-Fi, reconnecting your router or changing VPN, run the `curl` command again and update the SSH rule in Hetzner's console. The firewall does not prevent you from accessing Hetzner's website to change the rule. With this IPv4-only SSH rule, connect using the server's public IPv4 as shown in the SSH command above.
- **ICMP's port field is disabled** because ICMP carries network diagnostics and error messages rather than connecting to an application port. It does not grant terminal access.
- **Port 80** supports HTTP redirects and certificate validation; **port 443** serves encrypted application traffic, GitHub login callbacks and webhooks. Allowing either through the firewall does not bypass SSH keys or MergeBrief authentication.
- **Do not add inbound 3000, 3001 or 5432**, even for an external database: that is an outbound connection the application opens. Empty outbound rules permit package downloads, DNS, GitHub and model HTTPS, and the database connection: an attached Hetzner Firewall blocks unmatched inbound traffic and allows outbound traffic when no outbound rules exist ([firewall semantics](https://docs.hetzner.com/cloud/firewalls/overview/)).

After creation, point `brief.example.com`'s A record at the public IPv4. Add an AAAA record only after testing inbound IPv6. Having IPv6 enabled does not require publishing AAAA. Docker containers also need working outbound IPv6 before they can use an IPv6-only database endpoint; host connectivity alone does not establish this. Continue with section 2.

### AWS EC2

These steps follow AWS's documentation and have not been run end to end yet. Console wording moves, so where a label differs, pick the nearest one.

In the [EC2 console](https://console.aws.amazon.com/ec2/), select your region at the top right, then click **Launch instance**:

| Console section | Pick for a first deployment | Reason |
| --- | --- | --- |
| Name | **mergebrief-test** | Identifies the instance in the console. |
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

Port 80 supports redirects and certificate validation; 443 serves the application, GitHub login callbacks and webhooks. **My IP** is your address at that moment. If it changes, for example on a VPN, update the SSH rule in `mergebrief-app`. Otherwise SSH hangs.

After launching, on your own computer, protect the key:

```sh
mv ~/Downloads/mergebrief-admin.pem ~/.ssh/
chmod 400 ~/.ssh/mergebrief-admin.pem
```

Give the instance an address that survives a stop:

1. Open **Network & Security → Elastic IPs**, click **Allocate Elastic IP address**, then **Allocate**.
2. Select it, then **Actions → Associate Elastic IP address**. Set **Resource type** to **Instance**, choose the instance, and click **Associate**.
3. Point `brief.example.com`'s A record at that address.
4. Connect as `ubuntu`:

   ```sh
   ssh -i ~/.ssh/mergebrief-admin.pem ubuntu@<elastic-ip>
   ```

Continue with section 2. For RDS, you create the database in [Private RDS from EC2](#private-rds-from-ec2), once this instance exists.

EC2, EBS, snapshots and public IPv4 have separate billing lifecycles. Stopping a VM does not delete its storage or release every charge. Consult [AWS security group guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-security-groups.html).

## 2. Install Docker and HTTPS

Install Docker Engine and the Compose plugin using the [official Ubuntu apt-repository instructions](https://docs.docker.com/engine/install/ubuntu/). Use Compose v2.24.4 or newer. Install Caddy using its [official Ubuntu package instructions](https://caddyserver.com/docs/install#debian-ubuntu-raspbian). Use a maintained system service for both:

```sh
sudo systemctl enable --now docker
sudo systemctl enable --now caddy
sudo docker compose version
```

The commands below use `sudo docker`; membership in the docker group is root-equivalent and is not required. Install `curl` and `openssl` if missing. Apply Ubuntu security updates before opening the application. Docker-published ports can bypass UFW, so keep the shipped loopback bindings and enforce the cloud firewall too.

Once DNS points at this host, write the Caddyfile and reload Caddy with steps 3 and 4 of [Put HTTPS in front on a server](compose.md#put-https-in-front-on-a-server), and run its check. Caddy obtains and renews the certificate; the application stays HTTP on loopback. Do not put browser authentication in front of the GitHub webhook route. Before sustained public use, apply the webhook rate-limit guidance in [Compose hardening](compose.md#hardening-before-real-exposure): standard Caddy does not include a rate limiter.

## 3. Select an exact application version

The host holds one folder, with no checkout of the repository and no build. Make its parent, and keep new files private to you for the rest of this shell:

```sh
mkdir -p ~/deploy && cd ~/deploy
umask 077
```

Then run [Get the release files](compose.md#get-the-release-files) from there, with its check. It creates `~/deploy/mergebrief`, where every later command runs.

For an external database (RDS, Neon or Supabase), also fetch the overlay of the same release: the `curl` step of [External Postgres](compose.md#external-postgres-managed-database). Section 5B names it in `COMPOSE_FILE`.

Do not edit the Compose files: an upgrade replaces them byte for byte. Your own settings go in `.env` and `docker-compose.override.yml`. Finish sections 4 and 5 before starting the services.

Contributors testing unpublished changes build from source instead: see the [appendix](#appendix-source-builds-for-contributors).

## 4. Configure GitHub, sessions and model access

Register the GitHub App with `https://brief.example.com` as its origin, following [github-app.md](github-app.md) through [Install the App](github-app.md#install-the-app). Install it on a test repository. Keep the webhook secret you generated there and entered in the App's **Webhook secret** field: `.env` needs the same value. Deliveries fail until the stack runs; you redeliver one in section 6.

Fill in `.env` on the VM with an editor, following [Fill in `.env`](compose.md#fill-in-env): it has the commands, the filled-in block with `POSTGRES_PASSWORD`, and what each value must look like. On a VM:

- **Generate the secrets in a trusted terminal,** and keep the output out of shared terminal recordings, issues, logs and command arguments. Keep the session key in your secret backup too: after a database restore, the reviewer credentials stored in the database can only be read with the same key.
- **The private key is on your own computer.** Open the `.pem` file there and paste its contents, BEGIN and END lines included, inside the single quotes, or copy the file over as below.
- **With an external database,** leave `POSTGRES_PASSWORD` out: the overlay removes the bundled Postgres.
- **Another model provider** needs its block in the config file ([generators.md](generators.md)), not only a different key.

### Use a key file instead of the inline key

Follow [Use a key file instead of the inline key](compose.md#use-a-key-file-instead-of-the-inline-key), with two differences on a VM:

- **The `scp` target** is `<login>:~/deploy/mergebrief/secrets/github-app.pem`, where `<login>` is `root@<server-public-ipv4>` on Hetzner or `ubuntu@<elastic-ip>` on EC2, with the `-i` key you connect with.
- **With an external database,** merge the override entries into the one you create in section 5B.

### List who may sign in

An instance starts closed: nobody can sign in until its config names them. Print your GitHub user id, on any machine with the `gh` CLI ([who may start a brief](security-model.md#who-can-sign-in)):

```sh
gh api users/<your-login> --jq .id
```

On the VM, copy the example config and open it up to the containers' UID 1000: the `umask 077` from section 3 still applies in this shell, so a config file created here is unreadable by them. It holds variable names, not keys. Then replace the placeholder under `operators` with that id:

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

## 5A. Database on the same VM

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

## 5B. External database (RDS, Neon or Supabase)

Use PostgreSQL 16 or newer, preferably 17 to match the bundled one. Create a separate database or project for this instance in a region near the VM. `api` and `worker` use the same database; the browser and `web` need no database credentials.

The worker holds `LISTEN`/`NOTIFY` sessions and the boot migrations take a session advisory lock, so use a direct or session-mode connection, never a transaction pooler, and never a provider's REST API in place of Postgres. Follow your provider's steps below, then [store the connection string](#store-the-connection-string).

| Provider | Connection to pick | DSN ends with | CA file |
| --- | --- | --- | --- |
| RDS | The instance endpoint, private, from the same VPC | `?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem` | The region bundle |
| Neon | Direct: pooling off, no `-pooler` in the host | `?sslmode=verify-full` | None: the chain ends in a public root |
| Supabase | **Session pooler**, port 5432 | `?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem` | The project's CA certificate |

### Private RDS from EC2

These steps follow AWS's documentation and have not been run on RDS yet. The `psql` steps, the migrations and the TLS check were rehearsed on Postgres 17 with a non-superuser admin, a TLS-only server and a private CA bundle.

1. In the [RDS console](https://console.aws.amazon.com/rds/), in the same region as the instance, open **Databases → Create database**:

   | Field | Value | Reason |
   | --- | --- | --- |
   | Creation method | **Standard create** (may read **Full configuration**) | **Easy create** hides the version and backup settings. |
   | Engine | **PostgreSQL**, the newest **17** version | Matches the bundled Postgres. |
   | Template | **Dev/Test** or **Sandbox**, never **Production** | **Production** preselects Multi-AZ and paid IOPS storage. |
   | Availability | **Single DB instance** | Multi-AZ tests availability at extra cost. |
   | DB instance identifier | `mergebrief-test` | Becomes part of the endpoint. |
   | Master username | `postgres` | Used only to provision the app login below. |
   | Credentials management | **Self managed**. Generate a password in your password manager | You type it once in step 5. |
   | Instance class | **Burstable classes → db.t4g.micro** | Enough for a first deployment. The app's budget below is 12 connections. |
   | Storage | **General Purpose SSD (gp3)**, 20 GiB, encryption on | |
   | Compute resource | **Connect to an EC2 compute resource**, then your instance | See below. |
   | Certificate authority | Leave the default, `rds-ca-rsa2048-g1` | It is in every regional bundle. |
   | Initial database name | Leave empty | Step 6 creates the database with the right owner. |
   | Backups | Automated backups on, 7 days | |
   | Deletion protection | Off for a disposable database | |

   **Connect to an EC2 compute resource** does the private networking. RDS sets **Public access: No**, picks or creates a DB subnet group with private subnets only, and adds two security groups: `rds-ec2-n` on the database, admitting only the instance, and `ec2-rds-n` on the instance. A default VPC has no private subnets, so without this option you build them yourself. Do not edit these groups afterwards: RDS reuses them only if they stay unmodified.
2. Wait for status **Available**. On the database's **Connectivity & security** tab, copy the **Endpoint**. Use this DNS name, never a resolved IP, so hostname verification and failover keep working.
3. On the VM, from `~/deploy/mergebrief`, download your region's CA bundle. Replace `<region>` with the database's region, such as `eu-central-1`; [AWS's list](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html#UsingWithRDS.SSL.CertificatesAllRegions) has every bundle. The `chmod` matters: the `umask 077` from section 3 leaves the file private, and the containers read it as UID 1000. A CA certificate is public.

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   curl --fail --show-error --silent \
     --output secrets/provider-ca.pem \
     https://truststore.pki.rds.amazonaws.com/<region>/<region>-bundle.pem
   chmod 644 secrets/provider-ca.pem
   ```

4. Generate the app login's password and save it in your password manager. Hex needs no percent-encoding in a connection string:

   ```sh
   openssl rand -hex 24
   ```

5. Open `psql` as the administrator. The database is private, so this has to run on the VM, and Docker supplies the client. Connecting at all proves the security groups and TLS. It prompts for the master password:

   ```sh
   sudo docker run --rm -it \
     -v "$PWD/secrets/provider-ca.pem:/ca.pem:ro" \
     postgres:17-alpine \
     psql "host=<rds-endpoint> port=5432 dbname=postgres user=postgres sslmode=verify-full sslrootcert=/ca.pem"
   ```

6. Create the login and the database it owns. `\password` prompts for the password from step 4, which keeps it out of the server's logs:

   ```sql
   CREATE ROLE mergebrief_app LOGIN;
   \password mergebrief_app
   GRANT mergebrief_app TO CURRENT_USER;
   CREATE DATABASE mergebrief OWNER mergebrief_app;
   \q
   ```

   The `GRANT` is required. The RDS master user is not a superuser, and on Postgres 16 and newer it must be a member of a role to make it an owner ([`createrole_self_grant`](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)); otherwise the last statement answers `must be able to SET ROLE`. As owner, `mergebrief_app` can create the application and queue schemas, and it holds no RDS administration.

The finished string looks like this:

```text
postgresql://mergebrief_app:<hex-password>@mergebrief-test.abc123xyz.eu-central-1.rds.amazonaws.com:5432/mergebrief?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

`/etc/ssl/certs/provider-ca.pem` is the path inside the containers, where the override below mounts the bundle. Continue with [Store the connection string](#store-the-connection-string), and keep the provider CA override.

- The security groups admit the instance on the network; the connection still needs the login and verified TLS. Keep `rds.force_ssl` on, the default on RDS PostgreSQL 15 and newer ([RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)).
- Do not put a short-lived RDS IAM authentication token in the DSN: nothing refreshes it.
- Private RDS is not reachable from Hetzner. For a cross-cloud deployment use Neon or Supabase.
- Sources: [security groups for an application server](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.RDSSecurityGroups.html), [automatic EC2 connectivity](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html#USER_CreateDBInstance.Prerequisites.VPC.Automatic), [CA bundles](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html).

### Neon

These steps have been run once, from a Hetzner VM.

1. In the [Neon console](https://console.neon.tech), create a project:

   | Field | Value |
   | --- | --- |
   | Project name | `mergebrief-test` |
   | Postgres version | 17 |
   | Region | The one closest to your VM. Every api and worker query crosses this link. |

2. Click **Connect**. If Neon offers an agent prompt, choose **wire it myself**: that prompt edits application code and `.env`, and MergeBrief needs only the connection string. Keep the default branch, compute, database and role. That role owns the database, so it can create the app's schemas.
3. Turn off **Connection pooling**. Check that the hostname no longer contains `-pooler`. Neon's pooler runs in transaction mode, which [does not support](https://neon.com/docs/connect/connection-pooling) `LISTEN`/`NOTIFY` or session advisory locks.
4. Copy the connection string, then change its ending:

   | Neon shows | Use instead |
   | --- | --- |
   | `?sslmode=require&channel_binding=require` | `?sslmode=verify-full` |

   MergeBrief refuses `require` at boot, and its database driver ignores `channel_binding` in the URL. Neon's certificate chains to a public root (ISRG Root X1), so you need no CA file.

The finished string looks like this:

```text
postgresql://neondb_owner:<password>@ep-example-a1b2c3d4.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full
```

Neon's Free plan gives 100 CU-hours a month, which is 400 hours at 0.25 CU, or about 16 days of continuous running. The worker polls its queue every 2 seconds, so expect the compute not to scale to zero and the allowance to drain around the clock; this is not yet measured. When it runs out, Neon suspends the compute until the next billing period and the app loses its database. Keep the compute at 0.25 CU for a first deployment.

Continue with [Store the connection string](#store-the-connection-string).

### Supabase

These steps follow Supabase's [connection documentation](https://supabase.com/docs/guides/database/connecting-to-postgres) and have not been run end to end yet.

1. In the [Supabase dashboard](https://supabase.com/dashboard), create a project:

   | Field | Value |
   | --- | --- |
   | Project name | `mergebrief-test` |
   | Database password | Generate one and save it in your password manager |
   | Region | The one closest to your VM. Every api and worker query crosses this link. |

2. Click **Connect** at the top of the project, then choose **Session pooler**:

   | Option | Use it? | Why |
   | --- | --- | --- |
   | Session pooler | Yes | Reachable over IPv4 on every plan, and keeps the sessions the worker needs |
   | Direct connection | No | IPv6 only without the paid IPv4 add-on, and Compose containers have no IPv6 route by default |
   | Transaction pooler | Never | It drops the session state the worker relies on |

3. Copy the connection string and replace `[YOUR-PASSWORD]` with your password. Percent-encode any reserved character in it, such as `&`, `#`, `?`, `@`, `/` or a space. Keep the host and the `postgres.<project-ref>` username as shown.
4. Open the project's **Database Settings** page and download the CA certificate from its **SSL Configuration** section.
5. On the VM, from `~/deploy/mergebrief`, create the folder for it:

   ```sh
   mkdir -p secrets
   chmod 700 secrets
   ```

6. On your computer, copy the certificate over, using the file you downloaded. On EC2 the login is `ubuntu`, not `root`:

   ```sh
   scp <downloaded-ca-file> root@<server-public-ipv4>:~/deploy/mergebrief/secrets/provider-ca.pem
   ```

7. On the VM, let the containers read it. A CA certificate is public:

   ```sh
   chmod 644 secrets/provider-ca.pem
   ```

8. Add `?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem` to the end of the connection string. If TLS fails, fix the certificate. Never turn verification off to get past it.

The finished string looks like this:

```text
postgresql://postgres.abcdefghijklmnop:<url-encoded-password>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/provider-ca.pem
```

The session pooler holds one database connection per client, and the Free plan's default pool size is 15. The `DATABASE_POOL_MAX=3` set below needs up to 12, so leave it at 3. Supabase's session mode is also the least proven path here: when you reach [section 6](#6-check-the-stack-end-to-end), confirm that a push actually produces a brief.

### Store the connection string

Run these on the VM, from `~/deploy/mergebrief`.

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

The overlay removes the bundled `postgres` service, so the `POSTGRES_*` settings no longer apply. `COMPOSE_FILE` lists the override because setting it turns off the automatic override load. Compose file-backed secrets are mounted files, not an encrypted vault, so keep the `secrets` folder private. If your plan offers an IP allowlist, restrict the database to the VM's address too.

A pool max of 3 suits a small instance. With one api, one worker, and large concurrency 1, the pool budget is 12 connections: `3 + (2 * 3 + 1 + 2)`. Leave room for migrations, administration and provider reservations, and raise the pool size only within the database's limit.

The app login applies migrations at startup, so it needs DDL permissions. For separate migration and runtime roles, follow the [restricted-role migration instructions](compose.md#restricted-database-roles-mergebrief_auto_migratefalse) instead. Setting `MERGEBRIEF_AUTO_MIGRATE=false` alone does not initialize a database.

### Move an existing server to an external database

To move a running server with the database on the VM instead of starting a new one, stop it **before** you change `.env`. Once `COMPOSE_FILE` is set, Compose no longer knows the `postgres` service:

```sh
sudo docker compose down
```

Never add `-v`: that deletes the Postgres volume. A folder installed for the database on the VM holds no external-database overlay, because section 3 fetches it only for an external database. Fetch it now with the `curl` step of [External Postgres](compose.md#external-postgres-managed-database), which reads the release this instance runs from `docker-compose.yml`. A source build skips this step, because its checkout already holds the file.

Then follow your provider's steps and [Store the connection string](#store-the-connection-string), merging the override with the one you have.

Data does not move. The new database starts empty, so everyone signs in again and each pull request gets its next brief on its next push. Keep the same hostname and GitHub App only while the old stack stays stopped.

To switch back, run `down` again, remove `COMPOSE_FILE` and `DATABASE_URL_FILE` from `.env`, take the database entries out of the override, and start the stack with the section 5A commands.

## 6. Check the stack end to end

Run these from `~/deploy/mergebrief`, in order. Each step says what you should see.

1. **The services are up.**

   ```sh
   sudo docker compose ps -a
   ```

   `api` and `web` show `healthy` and `worker` shows `Up`; with the database on the VM, `postgres` shows `healthy` too. The worker has no health check, and a configuration error exits 0, so read its state here: `Exited (0)` means `sudo docker compose logs worker` ends with the reason.

2. **HTTPS reaches the database.**

   ```sh
   curl --fail --show-error https://brief.example.com/healthz
   curl --fail --show-error https://brief.example.com/readyz
   ```

   Both succeed. `/healthz` proves Caddy and `web`; `/readyz` proves `web` to `api` to the database. On an external database it also proves verified TLS: with `sslmode=verify-full`, the api cannot reach a database whose certificate does not verify. A `502` is Caddy with no `web` behind it yet.

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
9. **RDS only: TLS and privacy.** Repeat the `psql` command from [step 5](#private-rds-from-ec2) while the stack runs. Every row shows `ssl` as `t`:

   ```sql
   SELECT a.usename, s.ssl, s.version
   FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
   WHERE a.usename = 'mergebrief_app';
   ```

   Then, on your own computer, confirm the database is private. The answer is a private address, such as `172.31.x.x`:

   ```sh
   dig +short <rds-endpoint>
   ```

Optionally, test recovery: run `sudo docker compose restart worker` while a brief generates, and confirm the run finishes after the restart rather than staying stuck. Watch the provider's spend while it retries.

## 7. Start on boot

A reboot leaves the stack down: `restart: on-failure` does not bring services back when Docker starts, and `postgres` has no restart policy. Install the systemd unit from [Start on boot](compose.md#start-on-boot), running its commands from the instance folder so `WorkingDirectory` gets this folder's path:

```sh
cd ~/deploy/mergebrief
```

**Check:** `systemctl cat mergebrief | grep WorkingDirectory` shows `/root/deploy/mergebrief` on Hetzner or `/home/ubuntu/deploy/mergebrief` on EC2. Then reboot:

```sh
sudo reboot
```

Reconnect, and from `~/deploy/mergebrief` repeat checks 1 and 2 from [section 6](#6-check-the-stack-end-to-end). Deliveries GitHub sent while the VM was down are resent by the worker within about 30 minutes, or redeliver one from the App's **Advanced** tab.

## 8. Back up the instance

Back up the database and the files that unlock it, and keep both off the VM.

- **The database on the VM.** Dump it, then copy the dump to your own computer:

  ```sh
  sudo docker compose exec -T postgres \
    sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
    > mergebrief-$(date -u +%Y%m%dT%H%M%SZ).dump
  ```

  ```sh
  scp root@<server-public-ipv4>:~/deploy/mergebrief/mergebrief-*.dump .
  ```

  On EC2 the login is `ubuntu@<elastic-ip>`. Scheduling and restore are in [backup-restore.md](backup-restore.md#schedule-backups). A VM disk snapshot alone is not a consistent Postgres backup.

- **An external database (RDS, Neon or Supabase).** The provider's snapshots or point-in-time recovery are the backup. Turn them on for your plan and test a restore.
- **Every deployment: the instance's own files.** Copy `.env`, `mergebrief.config.yaml`, and `docker-compose.override.yml` and `secrets/` if you have them, into your password manager or an encrypted store. A restored database needs the same `SESSION_KEY_V1` to read the reviewer tokens it holds.

Prove a backup by restoring it into an isolated fresh database and pointing an isolated instance at it ([Restore](backup-restore.md#restore-in-place)). Do not run that instance's worker against production data or send it production webhooks.

## 9. Upgrade to a new release

Follow [upgrade.md](upgrade.md). It covers the backup, the replacement Compose file, the external-database variant and rollback. Repeat checks 1 to 3 of [section 6](#6-check-the-stack-end-to-end) afterwards.

Its commands run bare `docker`. On a VM set up by this guide, run them as written from a root shell, in the folder section 3 created. That folder sits under the home of the account that ran section 3: `/root` on Hetzner, `/home/ubuntu` on EC2.

```sh
sudo -s
cd /root/deploy/mergebrief   # on EC2: /home/ubuntu/deploy/mergebrief
```

Do not put `sudo` in front of each line instead. `sudo` drops variables set before a command, and one of the upgrade commands passes the database connection string that way. Leave the root shell with `exit` when the upgrade is done.

## Troubleshooting and cleanup

When a check fails, find what you see in [troubleshooting.md](troubleshooting.md#find-your-symptom). It covers this guide's cases too: a 502 from Caddy, a refused `sslmode`, a CA or secret file the container cannot read, an external database that times out, `must be able to SET ROLE`, and too many connections.

To retire an instance, follow [uninstall.md](uninstall.md) for GitHub and the host, then delete the cloud resources you created. Check VM disks, snapshots, Elastic and public IPs, managed databases, backup retention and DNS. Delete volumes only once the data is no longer needed. Rotate or revoke the credentials only that instance used. Deleting the EC2 instance does not delete its RDS database. Deleting the database does not remove its DB subnet group, private subnets or its `rds-ec2-n` and `ec2-rds-n` security groups. An Elastic IP keeps billing until released.

## Appendix: source builds for contributors

This path is for working on MergeBrief and testing unpublished changes. It is not an installation or upgrade path: a source build reports version `dev`, never checks for releases, and is not a published release. It needs `git` and Docker Buildx on the VM, and an image build may need more memory than running the application.

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

The build uses the selected checkout, and `--pull never` stops Compose from replacing it with a registry image. The explicit Postgres pull supplies the database image on a fresh host; skip it on an external database.

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
