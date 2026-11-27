-- L&D can reject any applicant (approved, pending or waitlisted) with a required justification.
-- Who rejected, from which state and when are kept for reporting (the justification is decision_comment).
ALTER TABLE "training_requests" ADD COLUMN "rejected_by_id" TEXT;
ALTER TABLE "training_requests" ADD COLUMN "rejected_from" TEXT;
ALTER TABLE "training_requests" ADD COLUMN "rejected_at" TIMESTAMP(3);

-- Earlier manager rejections: the rejected approval step says who and when
UPDATE "training_requests" r
SET "rejected_by_id" = s."approver_id", "rejected_from" = 'pending', "rejected_at" = s."decided_at"
FROM "approval_steps" s
WHERE s."request_id" = r."id" AND s."status" = 'rejected' AND r."state" = 'rejected' AND r."rejected_by_id" IS NULL;

-- Manager approval no longer means "seat confirmed": the L&D team sends the training invitation.
-- Only updated where L&D hasn't already edited the template.
UPDATE "notification_templates"
SET "name" = 'Registration Approved',
    "trigger" = 'Manager approves and a seat is free, or L&D registers someone',
    "subject" = 'Registration approved: {{training_title}}',
    "body" = 'The registration of {{employee_name}} for {{session_code}} — {{training_title}} ({{dates}}, {{location}}) has been approved. The L&D team will send the training invitation with the joining details.'
WHERE "id" = 'enrolled'
  AND "body" = 'Your seat is confirmed for {{session_code}} on {{dates}} at {{location}}. Joining instructions and pre-work are attached.';

-- One email when L&D rejects, with the justification, to the employee and their manager
INSERT INTO "notification_templates" ("id", "name", "trigger", "subject", "body", "updated_at") VALUES
  ('ld_rejected', 'Registration Not Approved (L&D)', 'L&D rejects an applicant or a waitlisted person (sent to the employee and their manager)',
   'Registration not approved: {{training_title}}',
   'The L&D team has not approved the registration of {{employee_name}} for {{session_code}} — {{training_title}} ({{dates}}, {{location}}).

Justification: {{comment}}',
   CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
