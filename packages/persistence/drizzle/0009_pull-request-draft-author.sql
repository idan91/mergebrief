ALTER TABLE "pull_request" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "author_login" text;