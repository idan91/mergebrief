-- Custom migration: raw-SQL items from ADR 0018's implementation notes.
-- Hand-maintained; drizzle-kit does not regenerate this file.
-- (Drizzle migrations are forward-only by design — no down step; rollback
-- of this file is `DROP INDEX "pull_request_purge_after_idx"`.)

-- D5 — retention sweep support: partial index on the sweep target.
-- Sweep query: WHERE purge_after IS NOT NULL AND purge_after < now().
-- Partial (not full) so open / never-swept PRs (purge_after IS NULL)
-- cost nothing.
CREATE INDEX "pull_request_purge_after_idx" ON "pull_request" ("purge_after") WHERE "purge_after" IS NOT NULL;

-- D9 — audit_log append-only hardening (DOCUMENTED, NOT EXECUTED in M1).
--
-- ADR 0018 D9: "Append-only by convention in M1; DB REVOKE UPDATE/DELETE
-- from the app role is the hosted hardening step."
--
-- M1 has no dedicated app role — the application connects as the schema's
-- owning role, and revoking UPDATE/DELETE from an owner is ineffective
-- (owners can re-grant themselves) while interfering with the implicit
-- permissions maintenance the owning role relies on for inserts. When the
-- hosted arm introduces a dedicated least-privilege app role, enable the
-- statements below (INSERT + SELECT only):
--
-- REVOKE UPDATE, DELETE ON TABLE "audit_log" FROM app_role;
-- GRANT INSERT, SELECT ON TABLE "audit_log" TO app_role;
