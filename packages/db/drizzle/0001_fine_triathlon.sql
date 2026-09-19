CREATE TYPE "public"."join_policy" AS ENUM('automatic', 'approval');--> statement-breakpoint
CREATE TYPE "public"."pending_reason" AS ENUM('awaiting_approval', 'seats_exhausted', 'no_licence');--> statement-breakpoint
ALTER TYPE "public"."portal_role" ADD VALUE 'org_admin';--> statement-breakpoint
ALTER TYPE "public"."member_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "join_policy" "join_policy" DEFAULT 'automatic' NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_users" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "org_users" ADD COLUMN "pending_reason" "pending_reason";--> statement-breakpoint
ALTER TABLE "org_users" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "org_users" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_users" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "org_users" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_users" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_reviewed_by_portal_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."portal_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_portal_users_org" ON "portal_users" USING btree ("org_id") WHERE org_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_user_org_scope" CHECK (("portal_users"."role"::text = 'org_admin') = ("portal_users"."org_id" IS NOT NULL));--> statement-breakpoint
UPDATE "org_users" SET "pending_reason" = 'seats_exhausted' WHERE "status" = 'pending' AND "pending_reason" IS NULL;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_user_pending_has_reason" CHECK (("org_users"."status"::text = 'pending') = ("org_users"."pending_reason" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_user_rejected_reviewed" CHECK ("org_users"."status"::text <> 'rejected' OR "org_users"."reviewed_at" IS NOT NULL);