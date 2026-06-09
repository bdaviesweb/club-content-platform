ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS selected_channels JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS club_workflow_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE UNIQUE,
  policy_key TEXT NOT NULL DEFAULT 'default',
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_workflow_policies_club_id
  ON club_workflow_policies(club_id);

WITH ranked_memberships AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY club_id,
                        COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::UUID),
                        user_id,
                        role
           ORDER BY created_at ASC, id ASC
         ) AS duplicate_rank
  FROM memberships
)
DELETE FROM memberships
WHERE id IN (
  SELECT id
  FROM ranked_memberships
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_unique_scope_user_role
  ON memberships(
    club_id,
    COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::UUID),
    user_id,
    role
  );
