-- contracts 0.1.0
-- The audit log stops holding an address: behind the web tier every row read
-- the proxy's socket, so the column only ever recorded one value.
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_caller_ip_shape";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "caller_ip";