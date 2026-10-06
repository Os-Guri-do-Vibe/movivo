-- Rotações antigas estendiam a validade. Recupera o primeiro prazo de cada família,
-- inclusive das gerações já revogadas, sem prorrogar nem apagar sessões.
WITH deadlines AS (
  SELECT family_id, min(expires_at) AS expires_at
  FROM auth_sessions
  GROUP BY family_id
)
UPDATE auth_sessions AS session
SET expires_at = deadlines.expires_at
FROM deadlines
WHERE session.family_id = deadlines.family_id
  AND session.expires_at > deadlines.expires_at;
