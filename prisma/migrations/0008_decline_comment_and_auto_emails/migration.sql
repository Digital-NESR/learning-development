-- Managers give a reason when declining; it is shown to the employee and included in their email.
ALTER TABLE "training_requests" ADD COLUMN "decision_comment" TEXT;
ALTER TABLE "approval_steps" ADD COLUMN "comment" TEXT;

-- Templates for the new automatic emails.
INSERT INTO "notification_templates" ("id", "name", "trigger", "subject", "body", "updated_at") VALUES
  ('waitlisted', 'Added to Waitlist', 'Manager approves but the class is full or registration is closed',
   'You are on the waitlist: {{training_title}}',
   'Your manager approved your request for {{session_code}} — {{training_title}} on {{dates}}, but the class is full or registration has closed. You are on the waitlist and the L&D team will contact you if a seat becomes available.',
   CURRENT_TIMESTAMP),
  ('cancelled', 'Training Cancelled', 'L&D deletes a training',
   'Cancelled: {{training_title}}',
   'We are sorry to let you know that {{session_code}} — {{training_title}} ({{dates}}, {{location}}) has been cancelled. Your registration has been closed. Please check the Training Portal for other sessions.',
   CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
