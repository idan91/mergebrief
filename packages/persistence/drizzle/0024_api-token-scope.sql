-- Every token minted before this migration keeps the reach it already had:
-- a read-only backfill would 403 every running CLI on deploy day, and a
-- self-host install has no operator on hand to explain it. The DEFAULT exists
-- only to fill those rows and is dropped immediately, so a later mint must
-- choose a scope rather than inherit the widest one.
ALTER TABLE "api_token" ADD COLUMN "scope" text DEFAULT 'external-write' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ALTER COLUMN "scope" DROP DEFAULT;--> statement-breakpoint
-- Keep this list in lockstep with the `as const` map in `src/types.ts`.
-- Rollback: drop the constraint.
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_scope_check"
CHECK ("scope" IN ('read', 'private-write', 'external-write'));
