-- Instructor profiles under Resources: a link and/or an uploaded profile document.
CREATE TABLE "instructor_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "bio" TEXT,
    "link" TEXT,
    "file_name" TEXT,
    "file_type" TEXT,
    "file_data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "instructor_profiles_pkey" PRIMARY KEY ("id")
);

-- The L&D team is emailed when a manager approves or declines a request.
INSERT INTO "notification_templates" ("id", "name", "trigger", "subject", "body", "updated_at") VALUES
  ('ld_decision', 'Manager Decision (to L&D)', 'A manager approves or declines a request (sent to the L&D team)',
   '{{manager_name}} {{decision}} {{employee_name}} for {{session_code}}',
   '{{manager_name}} has {{decision}} the request from {{employee_name}} for {{session_code}} — {{training_title}} ({{dates}}, {{location}}).

Result: {{result}}',
   CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
