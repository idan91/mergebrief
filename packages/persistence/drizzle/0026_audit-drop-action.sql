-- `operation` carries what `action` said, at descriptor granularity. Postgres
-- drops the column's CHECK with it; naming it keeps the rollback readable.
--
-- The add and the drop ship in one release deliberately: a self-host instance
-- is stopped and started as a unit (one compose stack, migrations at boot), so
-- there is no window where an old process writes `action` against the new
-- schema. A rolling deploy would need the drop held back a release.
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_action_check";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "action";
