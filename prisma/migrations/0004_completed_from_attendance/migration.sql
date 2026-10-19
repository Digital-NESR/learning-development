-- Requests are now "completed" once L&D marks the person as attended.
-- Apply that once to attendance already recorded.
UPDATE "training_requests" r
SET "state" = 'completed'
FROM "attendance" a
WHERE a."training_id" = r."training_id"
  AND a."employee_id" = r."employee_id"
  AND a."attended" = true
  AND r."state" = 'enrolled';
