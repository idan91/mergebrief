ALTER TABLE "reviewer_session" RENAME TO "auth_session";--> statement-breakpoint
ALTER SEQUENCE "public"."reviewer_session_id_seq" RENAME TO "auth_session_id_seq";--> statement-breakpoint
ALTER INDEX "reviewer_session_pkey" RENAME TO "auth_session_pkey";--> statement-breakpoint
ALTER INDEX "reviewer_session_installation_reviewer_idx" RENAME TO "auth_session_installation_reviewer_idx";--> statement-breakpoint
ALTER TABLE "auth_session" RENAME CONSTRAINT "reviewer_session_session_token_hash_unique" TO "auth_session_session_token_hash_unique";--> statement-breakpoint
ALTER TABLE "auth_session" RENAME CONSTRAINT "reviewer_session_grant_id_github_grant_id_fk" TO "auth_session_grant_id_github_grant_id_fk";