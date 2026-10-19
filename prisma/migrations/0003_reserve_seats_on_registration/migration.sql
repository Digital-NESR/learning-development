-- Seats are now reserved as soon as someone registers (pending / with L&D), not only on enrollment.
-- Count the existing pending and with-L&D requests once, so seat numbers are right from this deploy on.
UPDATE "trainings" t
SET "enrolled" = t."enrolled" + c.n
FROM (
  SELECT "training_id", COUNT(*)::int AS n
  FROM "training_requests"
  WHERE "state" IN ('pending', 'lnd')
  GROUP BY "training_id"
) c
WHERE c."training_id" = t."id";
