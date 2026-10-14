-- NESR L&D Portal — create tables
-- Run once in pgAdmin (Query Tool) on the target database, connected as a user that can create tables.
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in).
-- Must match prisma/schema.prisma; if the schema changes, update this file too.

BEGIN;

-- ---------- Types ----------
CREATE TYPE "RequestState" AS ENUM ('pending', 'lnd', 'enrolled', 'waitlist', 'rejected', 'completed');
CREATE TYPE "StepStatus"   AS ENUM ('waiting', 'approved', 'rejected');

-- ---------- 1. employees ----------
-- People. Created/updated automatically when someone signs in with Microsoft SSO.
CREATE TABLE "employees" (
    "id"            TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "email"         TEXT         NOT NULL,
    "entra_oid"     TEXT,
    "name"          TEXT         NOT NULL,
    "first_name"    TEXT         NOT NULL,
    "nesr_id"       TEXT,
    "title"         TEXT,
    "department"    TEXT,
    "location"      TEXT,
    "country"       TEXT,
    "is_admin"      BOOLEAN      NOT NULL DEFAULT false,
    "manager_id"    TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employees_email_key"     ON "employees"("email");
CREATE UNIQUE INDEX "employees_entra_oid_key" ON "employees"("entra_oid");

-- ---------- 2. trainings ----------
-- The training calendar. is_active = false means withdrawn.
CREATE TABLE "trainings" (
    "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "code"        TEXT         NOT NULL,
    "title"       TEXT         NOT NULL,
    "category"    TEXT         NOT NULL,
    "type"        TEXT         NOT NULL,
    "start_date"  DATE         NOT NULL,
    "end_date"    DATE         NOT NULL,
    "location"    TEXT         NOT NULL,
    "seats"       INTEGER      NOT NULL,
    "enrolled"    INTEGER      NOT NULL DEFAULT 0,
    "instructor"  TEXT,
    "description" TEXT,
    "is_active"   BOOLEAN      NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "trainings_start_date_idx" ON "trainings"("start_date");

-- ---------- 3. training_requests ----------
-- One request per employee per training.
CREATE TABLE "training_requests" (
    "id"            TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
    "employee_id"   TEXT           NOT NULL,
    "training_id"   TEXT           NOT NULL,
    "state"         "RequestState" NOT NULL DEFAULT 'pending',
    "current_step"  INTEGER        NOT NULL DEFAULT 0,
    "justification" TEXT,
    "form"          JSONB,
    "submitted_at"  TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "training_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        "training_requests_state_idx"                   ON "training_requests"("state");
CREATE UNIQUE INDEX "training_requests_employee_id_training_id_key" ON "training_requests"("employee_id", "training_id");

-- ---------- 4. approval_steps ----------
-- Ordered approval chain for each request (step 0 = line manager).
CREATE TABLE "approval_steps" (
    "id"          TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "request_id"  TEXT         NOT NULL,
    "step_no"     INTEGER      NOT NULL,
    "approver_id" TEXT         NOT NULL,
    "status"      "StepStatus" NOT NULL DEFAULT 'waiting',
    "decided_at"  TIMESTAMP(3),
    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);
CREATE INDEX        "approval_steps_approver_id_idx"        ON "approval_steps"("approver_id");
CREATE UNIQUE INDEX "approval_steps_request_id_step_no_key" ON "approval_steps"("request_id", "step_no");

-- ---------- 5. attendance ----------
CREATE TABLE "attendance" (
    "training_id"  TEXT         NOT NULL,
    "employee_id"  TEXT         NOT NULL,
    "attended"     BOOLEAN      NOT NULL,
    "marked_by_id" TEXT,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_pkey" PRIMARY KEY ("training_id", "employee_id")
);

-- ---------- 6. notification_templates ----------
CREATE TABLE "notification_templates" (
    "id"         TEXT         NOT NULL,
    "name"       TEXT         NOT NULL,
    "trigger"    TEXT         NOT NULL,
    "subject"    TEXT         NOT NULL,
    "body"       TEXT         NOT NULL,
    "is_active"  BOOLEAN      NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- ---------- 7. audit_log ----------
CREATE TABLE "audit_log" (
    "id"         BIGSERIAL    NOT NULL,
    "actor_id"   TEXT,
    "action"     TEXT         NOT NULL,
    "entity"     TEXT         NOT NULL,
    "entity_id"  TEXT         NOT NULL,
    "details"    JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- ---------- Foreign keys ----------
ALTER TABLE "employees"         ADD CONSTRAINT "employees_manager_id_fkey"          FOREIGN KEY ("manager_id")  REFERENCES "employees"("id")         ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "training_requests" ADD CONSTRAINT "training_requests_training_id_fkey" FOREIGN KEY ("training_id") REFERENCES "trainings"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "approval_steps"    ADD CONSTRAINT "approval_steps_request_id_fkey"     FOREIGN KEY ("request_id")  REFERENCES "training_requests"("id") ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "approval_steps"    ADD CONSTRAINT "approval_steps_approver_id_fkey"    FOREIGN KEY ("approver_id") REFERENCES "employees"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "attendance"        ADD CONSTRAINT "attendance_training_id_fkey"        FOREIGN KEY ("training_id") REFERENCES "trainings"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "attendance"        ADD CONSTRAINT "attendance_employee_id_fkey"        FOREIGN KEY ("employee_id") REFERENCES "employees"("id")         ON DELETE CASCADE  ON UPDATE CASCADE;

COMMIT;
