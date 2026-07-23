-- BRIEF-40 (ADR 0018 D15; ADR 0016 #4 as amended 2026-07-23): the GitHub
-- credential pair moves off `reviewer_session`/`api_token` into ONE
-- `github_grant` row per authorization, referenced by FK — a single physical
-- copy makes refresh divergence (single-use refresh token copied into two
-- rows) unrepresentable.
--
-- Order matters on a live database: create table → add NULLABLE grant_id →
-- backfill (dedup by exact ciphertext triple — mint copied ciphertext
-- verbatim, so a not-yet-diverged token matches its source session
-- byte-for-byte and joins its grant; diverged rows genuinely hold different
-- pairs and get their own) → integrity guard → SET NOT NULL + FK → drop the
-- old columns. No down migration (repo convention, drizzle/ is append-only):
-- the drop discards per-row ciphertext copies, which cannot be reconstructed
-- — irreversible by design; restore from backup if ever needed.
CREATE TABLE "github_grant" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_grant_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"gh_token_ciphertext" text NOT NULL,
	"gh_refresh_token_ciphertext" text NOT NULL,
	"key_ref" text NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_token" ADD COLUMN "grant_id" bigint;--> statement-breakpoint
ALTER TABLE "reviewer_session" ADD COLUMN "grant_id" bigint;--> statement-breakpoint
-- Backfill: one grant per DISTINCT (access, refresh, key_ref) triple across
-- both tables. `refresh_expires_at` comes from the session arm's `expires_at`
-- (which tracks the ~6mo refresh token today); the token arm contributes NULL
-- (its `expires_at` is mint-chosen, unrelated) — a triple with no session row
-- falls back to now() + 6 months (GitHub bounds the real pair regardless).
INSERT INTO "github_grant" ("gh_token_ciphertext", "gh_refresh_token_ciphertext", "key_ref", "refresh_expires_at")
SELECT
	u."gh_token_ciphertext",
	u."gh_refresh_token_ciphertext",
	u."key_ref",
	COALESCE(MAX(u."refresh_expires_at"), now() + interval '6 months')
FROM (
	SELECT "gh_token_ciphertext", "gh_refresh_token_ciphertext", "key_ref", "expires_at" AS "refresh_expires_at"
	FROM "reviewer_session"
	UNION ALL
	SELECT "gh_token_ciphertext", "gh_refresh_token_ciphertext", "key_ref", NULL
	FROM "api_token"
) u
GROUP BY u."gh_token_ciphertext", u."gh_refresh_token_ciphertext", u."key_ref";--> statement-breakpoint
UPDATE "reviewer_session" s
SET "grant_id" = g."id"
FROM "github_grant" g
WHERE s."gh_token_ciphertext" = g."gh_token_ciphertext"
	AND s."gh_refresh_token_ciphertext" = g."gh_refresh_token_ciphertext"
	AND s."key_ref" = g."key_ref";--> statement-breakpoint
UPDATE "api_token" t
SET "grant_id" = g."id"
FROM "github_grant" g
WHERE t."gh_token_ciphertext" = g."gh_token_ciphertext"
	AND t."gh_refresh_token_ciphertext" = g."gh_refresh_token_ciphertext"
	AND t."key_ref" = g."key_ref";--> statement-breakpoint
-- Guard before the destructive step: every row must have found its grant.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "reviewer_session" WHERE "grant_id" IS NULL)
		OR EXISTS (SELECT 1 FROM "api_token" WHERE "grant_id" IS NULL) THEN
		RAISE EXCEPTION 'BRIEF-40 grant backfill left rows without grant_id';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "api_token" ALTER COLUMN "grant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviewer_session" ALTER COLUMN "grant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_token" ADD CONSTRAINT "api_token_grant_id_github_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."github_grant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviewer_session" ADD CONSTRAINT "reviewer_session_grant_id_github_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."github_grant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_token" DROP COLUMN "gh_token_ciphertext";--> statement-breakpoint
ALTER TABLE "api_token" DROP COLUMN "gh_refresh_token_ciphertext";--> statement-breakpoint
ALTER TABLE "api_token" DROP COLUMN "key_ref";--> statement-breakpoint
ALTER TABLE "reviewer_session" DROP COLUMN "gh_token_ciphertext";--> statement-breakpoint
ALTER TABLE "reviewer_session" DROP COLUMN "gh_refresh_token_ciphertext";--> statement-breakpoint
ALTER TABLE "reviewer_session" DROP COLUMN "key_ref";
