CREATE TYPE "public"."device_code_status" AS ENUM('pending', 'approved', 'denied', 'used');--> statement-breakpoint
CREATE TABLE "device_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_hash" text NOT NULL,
	"user_code" text NOT NULL,
	"client_name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"status" "device_code_status" DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"api_key_id" uuid,
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_codes_device_hash_unique" UNIQUE("device_hash"),
	CONSTRAINT "device_codes_user_code_unique" UNIQUE("user_code")
);
--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_codes_expires_at_idx" ON "device_codes" USING btree ("expires_at");