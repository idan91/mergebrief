CREATE TABLE "api_token" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "api_token_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" bigint NOT NULL,
	"user_login" text,
	"name" text NOT NULL,
	"gh_token_ciphertext" text NOT NULL,
	"gh_refresh_token_ciphertext" text NOT NULL,
	"key_ref" text NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "api_token_user_idx" ON "api_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_token_installation_idx" ON "api_token" USING btree ("installation_id");