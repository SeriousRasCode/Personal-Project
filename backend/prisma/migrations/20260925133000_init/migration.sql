-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CITIZEN', 'STANDPIPE_OPERATOR', 'DISPATCHER', 'FIELD_TECHNICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'PHONE_VERIFICATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WindowStatus" AS ENUM ('SCHEDULED', 'OPENED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('FULL_FLOW', 'TRICKLE', 'DRY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReportSource" AS ENUM ('CITIZEN_APP', 'OPERATOR_APP', 'USSD', 'DISPATCHER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "QueueTrend" AS ENUM ('IMPROVING', 'STABLE', 'WORSE');

-- CreateEnum
CREATE TYPE "LeakStatus" AS ENUM ('OPEN', 'TRIAGED', 'INVESTIGATING', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LeakSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SensorType" AS ENUM ('PRESSURE', 'FLOW', 'COMBINED', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "SensorStatus" AS ENUM ('ACTIVE', 'OFFLINE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "TelemetrySource" AS ENUM ('SENSOR', 'MANUAL', 'CSV_IMPORT', 'SIMULATOR');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'SMS', 'USSD', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "display_name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255),
    "role" "UserRole" NOT NULL DEFAULT 'CITIZEN',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citizen_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kebele_id" UUID,
    "neighborhood_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "citizen_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standpipe_operator_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operator_code" VARCHAR(40) NOT NULL,
    "license_number" VARCHAR(80),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standpipe_operator_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "phone" VARCHAR(20) NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kebeles" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "center" geometry(Point, 4326),
    "boundary" geometry(MultiPolygon, 4326),
    "population" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kebeles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighborhoods" (
    "id" UUID NOT NULL,
    "kebele_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "center" geometry(Point, 4326),
    "boundary" geometry(MultiPolygon, 4326),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neighborhoods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standpipes" (
    "id" UUID NOT NULL,
    "kebele_id" UUID NOT NULL,
    "neighborhood_id" UUID,
    "operator_profile_id" UUID,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "location" geometry(Point, 4326) NOT NULL,
    "elevation_meters" DECIMAL(9,2),
    "capacity_liters_per_minute" DECIMAL(10,2),
    "installed_at" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standpipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "kebele_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "material" VARCHAR(60),
    "diameter_millimeters" INTEGER,
    "path" geometry(LineString, 4326) NOT NULL,
    "installed_at" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valves" (
    "id" UUID NOT NULL,
    "kebele_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "location" geometry(Point, 4326) NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "last_changed_at" TIMESTAMP(3),
    "last_changed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "valves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_schedules" (
    "id" UUID NOT NULL,
    "kebele_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_windows" (
    "id" UUID NOT NULL,
    "rotation_schedule_id" UUID NOT NULL,
    "standpipe_id" UUID,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "WindowStatus" NOT NULL DEFAULT 'SCHEDULED',
    "minimum_pressure_bar" DECIMAL(7,3),
    "maximum_pressure_bar" DECIMAL(7,3),
    "opened_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rotation_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tap_status_reports" (
    "id" UUID NOT NULL,
    "standpipe_id" UUID NOT NULL,
    "reported_by_id" UUID,
    "status" "FlowStatus" NOT NULL,
    "source" "ReportSource" NOT NULL DEFAULT 'CITIZEN_APP',
    "reliability_weight" DECIMAL(5,3) NOT NULL DEFAULT 1,
    "note" VARCHAR(500),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tap_status_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tap_consensus" (
    "id" UUID NOT NULL,
    "standpipe_id" UUID NOT NULL,
    "status" "FlowStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "full_flow_score" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "trickle_score" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "dry_score" DECIMAL(9,6) NOT NULL DEFAULT 0,
    "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_observed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tap_consensus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_wait_reports" (
    "id" UUID NOT NULL,
    "standpipe_id" UUID NOT NULL,
    "reported_by_id" UUID,
    "wait_minutes" INTEGER NOT NULL,
    "queue_size" INTEGER,
    "source" "ReportSource" NOT NULL DEFAULT 'CITIZEN_APP',
    "reliability_weight" DECIMAL(5,3) NOT NULL DEFAULT 1,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_wait_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_snapshots" (
    "id" UUID NOT NULL,
    "standpipe_id" UUID NOT NULL,
    "wait_minutes" DECIMAL(7,2) NOT NULL,
    "queue_size" INTEGER,
    "trend" "QueueTrend" NOT NULL DEFAULT 'STABLE',
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leak_reports" (
    "id" UUID NOT NULL,
    "reported_by_id" UUID,
    "cluster_id" UUID,
    "location" geometry(Point, 4326) NOT NULL,
    "description" TEXT NOT NULL,
    "photo_object_key" VARCHAR(512),
    "severity" "LeakSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "LeakStatus" NOT NULL DEFAULT 'OPEN',
    "source" "ReportSource" NOT NULL DEFAULT 'CITIZEN_APP',
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leak_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leak_clusters" (
    "id" UUID NOT NULL,
    "kebele_id" UUID NOT NULL,
    "neighborhood_id" UUID,
    "code" VARCHAR(40) NOT NULL,
    "centroid" geometry(Point, 4326),
    "radius_meters" DECIMAL(9,2),
    "severity" "LeakSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "LeakStatus" NOT NULL DEFAULT 'TRIAGED',
    "report_count" INTEGER NOT NULL DEFAULT 0,
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "first_reported_at" TIMESTAMP(3) NOT NULL,
    "last_reported_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leak_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "leak_cluster_id" UUID,
    "created_by_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "title" VARCHAR(180) NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "WorkOrderPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "scheduled_for" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_activities" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "from_status" "WorkOrderStatus",
    "to_status" "WorkOrderStatus",
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_sensors" (
    "id" UUID NOT NULL,
    "standpipe_id" UUID,
    "external_id" VARCHAR(100),
    "name" VARCHAR(120) NOT NULL,
    "type" "SensorType" NOT NULL DEFAULT 'PRESSURE',
    "status" "SensorStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" geometry(Point, 4326),
    "metadata" JSONB,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telemetry_sensors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pressure_readings" (
    "id" UUID NOT NULL,
    "sensor_id" UUID,
    "pressure_bar" DECIMAL(7,3) NOT NULL,
    "flow_liters_per_second" DECIMAL(10,3),
    "location" geometry(Point, 4326),
    "source" "TelemetrySource" NOT NULL,
    "external_id" VARCHAR(120),
    "observed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,

    CONSTRAINT "pressure_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pressure_aggregates" (
    "id" UUID NOT NULL,
    "sensor_id" UUID,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "average_pressure_bar" DECIMAL(7,3) NOT NULL,
    "minimum_pressure_bar" DECIMAL(7,3) NOT NULL,
    "maximum_pressure_bar" DECIMAL(7,3) NOT NULL,
    "sample_count" INTEGER NOT NULL,
    "cell" geometry(Point, 4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pressure_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "template" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "scheduled_for" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failure_reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ussd_sessions" (
    "id" UUID NOT NULL,
    "session_key" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "menu_path" VARCHAR(120) NOT NULL DEFAULT 'main',
    "state" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ussd_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" VARCHAR(100) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "key" VARCHAR(160) NOT NULL,
    "request_hash" VARCHAR(128) NOT NULL,
    "response_code" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(100) NOT NULL,
    "entity_id" VARCHAR(100),
    "request_id" VARCHAR(100),
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "citizen_profiles_user_id_key" ON "citizen_profiles"("user_id");

-- CreateIndex
CREATE INDEX "citizen_profiles_kebele_id_idx" ON "citizen_profiles"("kebele_id");

-- CreateIndex
CREATE INDEX "citizen_profiles_neighborhood_id_idx" ON "citizen_profiles"("neighborhood_id");

-- CreateIndex
CREATE UNIQUE INDEX "standpipe_operator_profiles_user_id_key" ON "standpipe_operator_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "standpipe_operator_profiles_operator_code_key" ON "standpipe_operator_profiles"("operator_code");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_purpose_expires_at_idx" ON "otp_challenges"("phone", "purpose", "expires_at");

-- CreateIndex
CREATE INDEX "otp_challenges_user_id_idx" ON "otp_challenges"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_expires_at_idx" ON "refresh_sessions"("user_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "kebeles_name_key" ON "kebeles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "kebeles_code_key" ON "kebeles"("code");

-- CreateIndex
CREATE INDEX "kebeles_is_active_idx" ON "kebeles"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "neighborhoods_code_key" ON "neighborhoods"("code");

-- CreateIndex
CREATE INDEX "neighborhoods_kebele_id_is_active_idx" ON "neighborhoods"("kebele_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "neighborhoods_kebele_id_name_key" ON "neighborhoods"("kebele_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "standpipes_code_key" ON "standpipes"("code");

-- CreateIndex
CREATE INDEX "standpipes_kebele_id_is_active_idx" ON "standpipes"("kebele_id", "is_active");

-- CreateIndex
CREATE INDEX "standpipes_neighborhood_id_idx" ON "standpipes"("neighborhood_id");

-- CreateIndex
CREATE INDEX "standpipes_operator_profile_id_idx" ON "standpipes"("operator_profile_id");

-- CreateIndex
CREATE INDEX "pipelines_kebele_id_is_active_idx" ON "pipelines"("kebele_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "valves_code_key" ON "valves"("code");

-- CreateIndex
CREATE INDEX "valves_kebele_id_idx" ON "valves"("kebele_id");

-- CreateIndex
CREATE INDEX "rotation_schedules_kebele_id_starts_on_ends_on_idx" ON "rotation_schedules"("kebele_id", "starts_on", "ends_on");

-- CreateIndex
CREATE INDEX "rotation_schedules_status_idx" ON "rotation_schedules"("status");

-- CreateIndex
CREATE INDEX "rotation_windows_rotation_schedule_id_starts_at_idx" ON "rotation_windows"("rotation_schedule_id", "starts_at");

-- CreateIndex
CREATE INDEX "rotation_windows_standpipe_id_starts_at_ends_at_idx" ON "rotation_windows"("standpipe_id", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "rotation_windows_status_starts_at_idx" ON "rotation_windows"("status", "starts_at");

-- CreateIndex
CREATE INDEX "tap_status_reports_standpipe_id_observed_at_idx" ON "tap_status_reports"("standpipe_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "tap_status_reports_reported_by_id_idx" ON "tap_status_reports"("reported_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "tap_consensus_standpipe_id_key" ON "tap_consensus"("standpipe_id");

-- CreateIndex
CREATE INDEX "tap_consensus_status_last_calculated_at_idx" ON "tap_consensus"("status", "last_calculated_at");

-- CreateIndex
CREATE INDEX "queue_wait_reports_standpipe_id_observed_at_idx" ON "queue_wait_reports"("standpipe_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "queue_wait_reports_reported_by_id_idx" ON "queue_wait_reports"("reported_by_id");

-- CreateIndex
CREATE INDEX "queue_snapshots_last_calculated_at_idx" ON "queue_snapshots"("last_calculated_at");

-- CreateIndex
CREATE INDEX "leak_reports_status_severity_created_at_idx" ON "leak_reports"("status", "severity", "created_at");

-- CreateIndex
CREATE INDEX "leak_reports_cluster_id_idx" ON "leak_reports"("cluster_id");

-- CreateIndex
CREATE INDEX "leak_reports_reported_by_id_idx" ON "leak_reports"("reported_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "leak_clusters_code_key" ON "leak_clusters"("code");

-- CreateIndex
CREATE INDEX "leak_clusters_kebele_id_status_idx" ON "leak_clusters"("kebele_id", "status");

-- CreateIndex
CREATE INDEX "leak_clusters_neighborhood_id_idx" ON "leak_clusters"("neighborhood_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_code_key" ON "work_orders"("code");

-- CreateIndex
CREATE INDEX "work_orders_status_priority_created_at_idx" ON "work_orders"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "work_orders_assigned_to_id_status_idx" ON "work_orders"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "work_orders_leak_cluster_id_idx" ON "work_orders"("leak_cluster_id");

-- CreateIndex
CREATE INDEX "work_order_activities_work_order_id_created_at_idx" ON "work_order_activities"("work_order_id", "created_at");

-- CreateIndex
CREATE INDEX "work_order_activities_actor_id_idx" ON "work_order_activities"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "telemetry_sensors_external_id_key" ON "telemetry_sensors"("external_id");

-- CreateIndex
CREATE INDEX "telemetry_sensors_standpipe_id_status_idx" ON "telemetry_sensors"("standpipe_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pressure_readings_external_id_key" ON "pressure_readings"("external_id");

-- CreateIndex
CREATE INDEX "pressure_readings_observed_at_idx" ON "pressure_readings"("observed_at" DESC);

-- CreateIndex
CREATE INDEX "pressure_readings_sensor_id_observed_at_idx" ON "pressure_readings"("sensor_id", "observed_at" DESC);

-- CreateIndex
CREATE INDEX "pressure_readings_source_observed_at_idx" ON "pressure_readings"("source", "observed_at");

-- CreateIndex
CREATE INDEX "pressure_aggregates_window_start_window_end_idx" ON "pressure_aggregates"("window_start", "window_end");

-- CreateIndex
CREATE UNIQUE INDEX "pressure_aggregates_sensor_id_window_start_window_end_key" ON "pressure_aggregates"("sensor_id", "window_start", "window_end");

-- CreateIndex
CREATE INDEX "notifications_user_id_status_created_at_idx" ON "notifications"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_key" ON "notification_preferences"("user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ussd_sessions_session_key_key" ON "ussd_sessions"("session_key");

-- CreateIndex
CREATE INDEX "ussd_sessions_phone_expires_at_idx" ON "ussd_sessions"("phone", "expires_at");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_created_at_idx" ON "audit_events"("actor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "citizen_profiles" ADD CONSTRAINT "citizen_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citizen_profiles" ADD CONSTRAINT "citizen_profiles_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citizen_profiles" ADD CONSTRAINT "citizen_profiles_neighborhood_id_fkey" FOREIGN KEY ("neighborhood_id") REFERENCES "neighborhoods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standpipe_operator_profiles" ADD CONSTRAINT "standpipe_operator_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standpipes" ADD CONSTRAINT "standpipes_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standpipes" ADD CONSTRAINT "standpipes_neighborhood_id_fkey" FOREIGN KEY ("neighborhood_id") REFERENCES "neighborhoods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standpipes" ADD CONSTRAINT "standpipes_operator_profile_id_fkey" FOREIGN KEY ("operator_profile_id") REFERENCES "standpipe_operator_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valves" ADD CONSTRAINT "valves_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_schedules" ADD CONSTRAINT "rotation_schedules_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_schedules" ADD CONSTRAINT "rotation_schedules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_windows" ADD CONSTRAINT "rotation_windows_rotation_schedule_id_fkey" FOREIGN KEY ("rotation_schedule_id") REFERENCES "rotation_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_windows" ADD CONSTRAINT "rotation_windows_standpipe_id_fkey" FOREIGN KEY ("standpipe_id") REFERENCES "standpipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tap_status_reports" ADD CONSTRAINT "tap_status_reports_standpipe_id_fkey" FOREIGN KEY ("standpipe_id") REFERENCES "standpipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tap_status_reports" ADD CONSTRAINT "tap_status_reports_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tap_consensus" ADD CONSTRAINT "tap_consensus_standpipe_id_fkey" FOREIGN KEY ("standpipe_id") REFERENCES "standpipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_wait_reports" ADD CONSTRAINT "queue_wait_reports_standpipe_id_fkey" FOREIGN KEY ("standpipe_id") REFERENCES "standpipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_wait_reports" ADD CONSTRAINT "queue_wait_reports_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_snapshots" ADD CONSTRAINT "queue_snapshots_standpipe_id_fkey" FOREIGN KEY ("standpipe_id") REFERENCES "standpipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leak_reports" ADD CONSTRAINT "leak_reports_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leak_reports" ADD CONSTRAINT "leak_reports_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "leak_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leak_clusters" ADD CONSTRAINT "leak_clusters_kebele_id_fkey" FOREIGN KEY ("kebele_id") REFERENCES "kebeles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leak_clusters" ADD CONSTRAINT "leak_clusters_neighborhood_id_fkey" FOREIGN KEY ("neighborhood_id") REFERENCES "neighborhoods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_leak_cluster_id_fkey" FOREIGN KEY ("leak_cluster_id") REFERENCES "leak_clusters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_activities" ADD CONSTRAINT "work_order_activities_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_activities" ADD CONSTRAINT "work_order_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_sensors" ADD CONSTRAINT "telemetry_sensors_standpipe_id_fkey" FOREIGN KEY ("standpipe_id") REFERENCES "standpipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pressure_readings" ADD CONSTRAINT "pressure_readings_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "telemetry_sensors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pressure_readings" ADD CONSTRAINT "pressure_readings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pressure_aggregates" ADD CONSTRAINT "pressure_aggregates_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "telemetry_sensors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "kebeles_center_gist_idx" ON "kebeles" USING GIST ("center");
CREATE INDEX "kebeles_boundary_gist_idx" ON "kebeles" USING GIST ("boundary");
CREATE INDEX "neighborhoods_center_gist_idx" ON "neighborhoods" USING GIST ("center");
CREATE INDEX "neighborhoods_boundary_gist_idx" ON "neighborhoods" USING GIST ("boundary");
CREATE INDEX "standpipes_location_gist_idx" ON "standpipes" USING GIST ("location");
CREATE INDEX "pipelines_path_gist_idx" ON "pipelines" USING GIST ("path");
CREATE INDEX "valves_location_gist_idx" ON "valves" USING GIST ("location");
CREATE INDEX "leak_reports_location_gist_idx" ON "leak_reports" USING GIST ("location");
CREATE INDEX "leak_clusters_centroid_gist_idx" ON "leak_clusters" USING GIST ("centroid");
CREATE INDEX "telemetry_sensors_location_gist_idx" ON "telemetry_sensors" USING GIST ("location");
CREATE INDEX "pressure_readings_location_gist_idx" ON "pressure_readings" USING GIST ("location");
CREATE INDEX "pressure_aggregates_cell_gist_idx" ON "pressure_aggregates" USING GIST ("cell");
