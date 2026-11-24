# Managed Postgres provider notes

What the requirements in [Managed Postgres](./server-deployment.md#5b-managed-postgres) mean on specific providers. Checked against official documentation on 2026-11-04. Neon's direct connection has run once from a VPS; Supabase and Amazon RDS are documentation research only, not tested deployments.

The rules behind every entry: a direct or session-mode connection, because the worker uses `LISTEN`/`NOTIFY` and the boot migrations take a session advisory lock ([Graphile Worker FAQ](https://worker.graphile.org/docs/faq)); `sslmode=verify-full`, with `sslrootcert` where the provider's CA is not a public root; and a pool budget sized with the formula in [compose.md](./compose.md).

## Neon

- Turn **Connection pooling** off in the Connect dialog and check the hostname has no `-pooler`. Neon's pooler is PgBouncer in transaction mode and lists `LISTEN`/`NOTIFY` and session advisory locks as unsupported ([pooling limitations](https://neon.com/docs/connect/connection-pooling)).
- Replace `?sslmode=require&channel_binding=require` with `?sslmode=verify-full`. The certificate chains to a public root (ISRG Root X1), so no CA file is needed.
- If the console offers an agent prompt, wire it yourself: MergeBrief needs only the connection string. The default role owns the default database.
- The Free plan's 100 CU-hours a month last about 16 days at 0.25 CU. The worker polls its queue every 2 seconds, so expect the compute not to scale to zero (not yet measured). When the allowance runs out, Neon suspends the compute and the app loses its database until the next billing period.

## Supabase

- The direct host `db.<project-ref>.supabase.co` is IPv6-only without the paid IPv4 add-on, and Compose containers have no IPv6 route by default. Use the **Session pooler** on port 5432 instead, keeping its hostname and `postgres.<project-ref>` username. Never the transaction pooler on port 6543 or the dedicated PgBouncer endpoint: both pool by transaction ([connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [IPv4 and IPv6](https://supabase.com/kb/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP)).
- Download the CA certificate from **Database Settings → SSL Configuration** and mount it as the provider CA.
- The session pooler holds one database connection per client and the Free plan's default pool size is 15, so keep `DATABASE_POOL_MAX=3` (12 connections).
- Session mode is the least proven path: confirm that a push actually produces a brief.

## Amazon RDS

- On **Create database**, choose **Connect to an EC2 compute resource** and select the instance. It sets **Public access: No**, picks or creates a DB subnet group of private subnets, and adds the `rds-ec2-n` and `ec2-rds-n` security groups that admit only that instance. A default VPC has no private subnets, so without this option you build them yourself. Do not edit those groups afterwards; RDS reuses them only while unmodified ([automatic connectivity](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_CreateDBInstance.html#USER_CreateDBInstance.Prerequisites.VPC.Automatic)).
- Use **Standard create** with a **Dev/Test** or **Sandbox** template: **Production** preselects Multi-AZ and paid IOPS storage. `db.t4g.micro` is enough for a first deployment.
- Leave **Initial database name** empty; the `CREATE DATABASE` step creates it with the right owner. The master user holds `CREATEROLE` and `CREATEDB` but is not a superuser, which is why the `GRANT` is required ([CREATE DATABASE](https://www.postgresql.org/docs/17/sql-createdatabase.html), [`createrole_self_grant`](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)).
- Download the regional bundle from AWS's [CA bundle table](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html#UsingWithRDS.SSL.CertificatesAllRegions), for example `https://truststore.pki.rds.amazonaws.com/eu-central-1/eu-central-1-bundle.pem`. The default `rds-ca-rsa2048-g1` authority is in every regional bundle. RDS for PostgreSQL 15+ forces TLS by default; keep it ([RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)).
- Do not use RDS IAM authentication tokens: they expire, and MergeBrief reads a static DSN.
- Deleting the instance does not delete the database, and deleting the database does not remove its subnet group or the two security groups. An Elastic IP keeps billing until released.
