CREATE TYPE "public"."license_mode" AS ENUM('internal', 'trial', 'standard');--> statement-breakpoint
CREATE TYPE "public"."license_status" AS ENUM('active', 'suspended', 'expired');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."portal_role" AS ENUM('owner', 'admin', 'support', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('active', 'disabled', 'stale');--> statement-breakpoint
CREATE TYPE "public"."member_source" AS ENUM('import', 'auto_domain', 'manual', 'approved_request');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'pending', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_email" "citext",
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"before_state" jsonb,
	"after_state" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocked_domains" (
	"value" "citext" PRIMARY KEY NOT NULL,
	"reason" text DEFAULT 'public_mailbox' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"license_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"old_end_date" date,
	"new_end_date" date,
	"old_status" "license_status",
	"new_status" "license_status",
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_roles" (
	"license_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"seats" integer DEFAULT 0 NOT NULL,
	"scopes" text[],
	CONSTRAINT "license_roles_license_id_role_key_pk" PRIMARY KEY("license_id","role_key"),
	CONSTRAINT "license_role_seats_sane" CHECK ("license_roles"."seats" >= 0)
);
--> statement-breakpoint
CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"mode" "license_mode" DEFAULT 'trial' NOT NULL,
	"status" "license_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"grace_days" smallint DEFAULT 7 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_dates_valid" CHECK ("licenses"."end_date" >= "licenses"."start_date"),
	CONSTRAINT "license_grace_sane" CHECK ("licenses"."grace_days" BETWEEN 0 AND 90)
);
--> statement-breakpoint
CREATE TABLE "org_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"value" "citext" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"primary_contact_email" "citext",
	"status" "org_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "panel_definitions" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"never_gated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"display_name" text,
	"role" "portal_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"password_hash" text,
	"password_changed_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_enrolled_at" timestamp with time zone,
	"totp_reset_required" boolean DEFAULT false NOT NULL,
	"last_totp_counter" bigint DEFAULT 0 NOT NULL,
	"session_epoch" integer DEFAULT 1 NOT NULL,
	"failed_attempts" smallint DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" "inet",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_users_email_unique" UNIQUE("email"),
	CONSTRAINT "portal_user_has_password" CHECK (NOT "portal_users"."is_active" OR "portal_users"."password_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" text PRIMARY KEY NOT NULL,
	"name" "citext" NOT NULL,
	"description" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"algorithm" text DEFAULT 'ES256' NOT NULL,
	"public_key" text NOT NULL,
	"private_ref" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"autodesk_id" text,
	"email" "citext" NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"reason" text NOT NULL,
	"email_domain" "citext",
	"device_hash" text NOT NULL,
	"machine_name" text,
	"revit_version" text,
	"status" "request_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"first_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_org_id" uuid,
	"granted_role_key" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text
);
--> statement-breakpoint
CREATE TABLE "addin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"org_user_id" uuid NOT NULL,
	"device_id" uuid,
	"refresh_token_hash" text NOT NULL,
	"previous_token_hash" text,
	"previous_rotated_at" timestamp with time zone,
	"aps_access_token_enc" text,
	"aps_refresh_token_enc" text,
	"aps_expires_at" timestamp with time zone,
	"aps_scopes" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_lifetime_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"last_refreshed_at" timestamp with time zone,
	CONSTRAINT "addin_sessions_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"org_user_id" uuid,
	"device_hash" text NOT NULL,
	"machine_name" text,
	"revit_versions" text[] DEFAULT '{}' NOT NULL,
	"addin_version" text,
	"status" "device_status" DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"code_challenge" text NOT NULL,
	"device_hash" text,
	"device_info" jsonb,
	"redirect_port" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"autodesk_id" text,
	"email" "citext",
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"given_name" text,
	"family_name" text,
	"role_key" text NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"source" "member_source" DEFAULT 'auto_domain' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_user_has_identity" CHECK ("org_users"."autodesk_id" IS NOT NULL OR "org_users"."email" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"org_id" uuid NOT NULL,
	"org_user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"launches" integer DEFAULT 0 NOT NULL,
	"heartbeats" integer DEFAULT 0 NOT NULL,
	"active_minutes" integer DEFAULT 0 NOT NULL,
	"revit_version" text,
	"addin_version" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_daily_org_id_org_user_id_device_id_usage_date_pk" PRIMARY KEY("org_id","org_user_id","device_id","usage_date")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_events" ADD CONSTRAINT "license_events_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_events" ADD CONSTRAINT "license_events_actor_id_portal_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_roles" ADD CONSTRAINT "license_roles_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_roles" ADD CONSTRAINT "license_roles_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_created_by_portal_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_domains" ADD CONSTRAINT "org_domains_created_by_portal_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_portal_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_users" ADD CONSTRAINT "portal_users_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_assigned_org_id_organizations_id_fk" FOREIGN KEY ("assigned_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_granted_role_key_roles_key_fk" FOREIGN KEY ("granted_role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewed_by_portal_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addin_sessions" ADD CONSTRAINT "addin_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addin_sessions" ADD CONSTRAINT "addin_sessions_org_user_id_org_users_id_fk" FOREIGN KEY ("org_user_id") REFERENCES "public"."org_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addin_sessions" ADD CONSTRAINT "addin_sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_user_id_org_users_id_fk" FOREIGN KEY ("org_user_id") REFERENCES "public"."org_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_role_key_roles_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_users" ADD CONSTRAINT "org_users_created_by_portal_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."portal_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_org_user_id_org_users_id_fk" FOREIGN KEY ("org_user_id") REFERENCES "public"."org_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_org_time" ON "audit_log" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_log" USING btree ("actor_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_license_events_license" ON "license_events" USING btree ("license_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_licenses_org" ON "licenses" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_licenses_expiry" ON "licenses" USING btree ("end_date") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_active_license_per_org" ON "licenses" USING btree ("org_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_domain_global" ON "org_domains" USING btree ("value");--> statement-breakpoint
CREATE INDEX "idx_org_domains_org" ON "org_domains" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_org_status" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_portal_users_active" ON "portal_users" USING btree ("is_active") WHERE is_active;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_default_role" ON "roles" USING btree ("is_default") WHERE is_default;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_request_email_device" ON "access_requests" USING btree ("email","device_hash");--> statement-breakpoint
CREATE INDEX "idx_access_requests_pending" ON "access_requests" USING btree ("status","last_attempt_at" DESC NULLS LAST) WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "idx_addin_sessions_user" ON "addin_sessions" USING btree ("org_user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_addin_sessions_device" ON "addin_sessions" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_addin_sessions_previous" ON "addin_sessions" USING btree ("previous_token_hash") WHERE previous_token_hash IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_device_per_org" ON "devices" USING btree ("org_id","device_hash");--> statement-breakpoint
CREATE INDEX "idx_devices_user" ON "devices" USING btree ("org_user_id");--> statement-breakpoint
CREATE INDEX "idx_devices_org_seen" ON "devices" USING btree ("org_id","last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_devices_stale" ON "devices" USING btree ("last_seen_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_oauth_states_expiry" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_user_autodesk_global" ON "org_users" USING btree ("autodesk_id") WHERE autodesk_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_user_email_global" ON "org_users" USING btree ("email") WHERE email IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_org_users_org_status" ON "org_users" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_org_users_org_role" ON "org_users" USING btree ("org_id","role_key","status");--> statement-breakpoint
CREATE INDEX "idx_org_users_activity" ON "org_users" USING btree ("org_id",last_activity_at DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_usage_daily_org_date" ON "usage_daily" USING btree ("org_id","usage_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_usage_daily_date" ON "usage_daily" USING btree ("usage_date");