-- Per-day attendance (QR check-in or marked by L&D)
CREATE TABLE "attendance_days" (
    "training_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "present" BOOLEAN NOT NULL,
    "method" TEXT NOT NULL,
    "marked_by_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("training_id","employee_id","day")
);
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_training_id_fkey" FOREIGN KEY ("training_id") REFERENCES "trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Feedback survey answers
CREATE TABLE "survey_responses" (
    "id" TEXT NOT NULL,
    "training_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "ratings" JSONB NOT NULL,
    "liked_best" TEXT,
    "action_plan" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "survey_responses_training_id_employee_id_key" ON "survey_responses"("training_id", "employee_id");
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_training_id_fkey" FOREIGN KEY ("training_id") REFERENCES "trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "survey_responses" ADD CONSTRAINT "survey_responses_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
