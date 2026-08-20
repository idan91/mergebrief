-- The whole-table UPDATE and the CHECK scans below take the table's lock for
-- the length of the rewrite, at boot when auto-migrate is on. Sized for it: a
-- busy instance writes on the order of 500k audit rows a year, which is dwarfed
-- by `brief` and `delta` and rewrites in seconds. Revisit with NOT VALID +
-- VALIDATE if an adopter ever reports a boot stall here.
--
-- Existing rows keep their history: `operation` inherits the value `action`
-- already held, and `outcome` reads the denial off the decision metadata the
-- old emits carried. Both columns are added nullable, backfilled, then set
-- NOT NULL, so this runs against a table that already has rows.
ALTER TABLE "audit_log" ADD COLUMN "operation" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "outcome" text;--> statement-breakpoint
UPDATE "audit_log" SET
  "operation" = "action",
  "outcome" = CASE
    WHEN "metadata" ->> 'decision' ~ '^[45]' THEN 'denied'
    ELSE 'ok'
  END;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "operation" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "outcome" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "classification" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "credential_id" bigint;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "client" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "caller_ip" text;--> statement-breakpoint

-- Keep these lists in lockstep with the `as const` maps in `src/types.ts`.
-- Rollback: drop the constraints.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_outcome_check"
CHECK ("outcome" IN ('ok', 'denied', 'failed'));--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_classification_check"
CHECK ("classification" IS NULL OR "classification" IN ('private-write', 'external-write'));--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_channel_check"
CHECK ("channel" IS NULL OR "channel" IN ('cookie', 'bearer', 'webhook', 'worker'));--> statement-breakpoint

-- `operation` is an open descriptor-id vocabulary owned by another package, so
-- it gets the shape check `target_type` gets rather than a value list: a
-- kebab-case token can carry no route, slug or address into a ledger the
-- operator may never purge.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_operation_shape"
CHECK ("operation" ~ '^[a-z][a-z0-9-]{0,63}$');--> statement-breakpoint

-- Forensic-only strings: bounded so no body or header can be smuggled in.
-- `caller_ip` is populated only under the operator PII flag; NULL is the
-- honest value when collection is off, which is why it is nullable.
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_request_id_shape"
CHECK ("request_id" IS NULL OR "request_id" ~ '^[A-Za-z0-9_-]{1,64}$');--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_client_shape"
CHECK ("client" IS NULL OR "client" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$');--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_caller_ip_shape"
CHECK ("caller_ip" IS NULL OR "caller_ip" ~ '^[0-9a-fA-F.:]{1,45}$');
