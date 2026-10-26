-- Manager approval is now final; there is no separate "with L&D" step.
-- Seats are taken on manager approval (enrolled), not when the request is submitted.

-- 1. Registration can be opened/closed per training.
ALTER TABLE "trainings" ADD COLUMN "registration_open" BOOLEAN NOT NULL DEFAULT true;

-- 2. Pending requests no longer hold a seat: give those seats back.
UPDATE "trainings" t
SET "enrolled" = GREATEST(t."enrolled" - c.n, 0)
FROM (
  SELECT "training_id", COUNT(*)::int AS n
  FROM "training_requests"
  WHERE "state" = 'pending'
  GROUP BY "training_id"
) c
WHERE c."training_id" = t."id";

-- 3. Requests already approved by the manager and waiting on L&D become enrolled (they already hold a seat).
UPDATE "training_requests" SET "state" = 'enrolled' WHERE "state" = 'lnd';
