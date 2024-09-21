CREATE TABLE IF NOT EXISTS "cursor" (
	"id" serial PRIMARY KEY NOT NULL,
	"last_cursor" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emoji_usage" (
	"id" serial NOT NULL,
	"emoji_id" bigint,
	"language" text,
	"timestamp" timestamp DEFAULT now(),
	"cursor" bigint
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emojis" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text,
	CONSTRAINT "emojis_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "languages" (
	"post_id" text,
	"language" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text,
	"did" text,
	"rkey" text,
	"cursor" bigint,
	"text" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "languages" ADD CONSTRAINT "languages_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
