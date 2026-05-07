-- One submission per user_id: drop extras (keep newest), then enforce uniqueness.

DELETE FROM app_feedback
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY created_at DESC NULLS LAST,
                      id DESC
           ) AS rn
    FROM app_feedback
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_feedback_user_one ON app_feedback (user_id);

COMMENT ON INDEX ux_app_feedback_user_one IS 'At most one feedback row per profile; delete before inserting another.';
