CREATE TABLE "user_settings" (
	"gh_user_id" bigint PRIMARY KEY NOT NULL,
	"default_installation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
