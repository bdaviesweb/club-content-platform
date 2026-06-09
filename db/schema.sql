CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE membership_role AS ENUM (
  'submitter_parent',
  'submitter_player',
  'submitter_coach',
  'team_manager',
  'club_admin',
  'club_comms',
  'publisher'
);

CREATE TYPE submission_content_type AS ENUM (
  'photo',
  'video',
  'text',
  'mixed'
);

CREATE TYPE submission_status AS ENUM (
  'received',
  'screening',
  'needs_metadata',
  'needs_human_review',
  'approved_internal',
  'approved_external',
  'rejected',
  'scheduled',
  'published',
  'publish_failed'
);

CREATE TYPE review_result_status AS ENUM (
  'passed',
  'flagged',
  'blocked',
  'error'
);

CREATE TYPE approval_state AS ENUM (
  'pending',
  'approved',
  'rejected',
  'changes_requested',
  'expired'
);

CREATE TYPE publishing_job_state AS ENUM (
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TABLE clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  age_group TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, slug)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role membership_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, team_id, user_id, role)
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  submitted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content_type submission_content_type NOT NULL,
  raw_text TEXT,
  selected_channels JSONB NOT NULL DEFAULT '[]'::JSONB,
  caption_draft TEXT,
  visibility_target TEXT NOT NULL DEFAULT 'internal',
  status submission_status NOT NULL DEFAULT 'received',
  risk_score NUMERIC(5,2),
  routing_decision JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE club_workflow_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE UNIQUE,
  policy_key TEXT NOT NULL DEFAULT 'default',
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE submission_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  media_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_seconds NUMERIC(8,2),
  checksum_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  version TEXT NOT NULL,
  result_status review_result_status NOT NULL,
  confidence NUMERIC(5,2),
  summary TEXT,
  raw_output_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE review_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_run_id UUID NOT NULL REFERENCES review_runs(id) ON DELETE CASCADE,
  finding_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  approver_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  approver_role membership_role NOT NULL,
  state approval_state NOT NULL DEFAULT 'pending',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id UUID NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
  acted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE publishing_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  destination_type TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE submission_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE publishing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES publishing_destinations(id) ON DELETE CASCADE,
  state publishing_job_state NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  result_summary TEXT,
  external_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE published_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES publishing_destinations(id) ON DELETE CASCADE,
  external_post_id TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  subject_name TEXT,
  consent_type TEXT NOT NULL,
  status TEXT NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_submissions_club_status ON submissions(club_id, status);
CREATE INDEX idx_club_workflow_policies_club_id ON club_workflow_policies(club_id);
CREATE UNIQUE INDEX idx_memberships_unique_scope_user_role
  ON memberships(club_id, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::UUID), user_id, role);
CREATE INDEX idx_submission_media_submission_id ON submission_media(submission_id);
CREATE INDEX idx_review_runs_submission_id ON review_runs(submission_id);
CREATE INDEX idx_approval_requests_submission_id ON approval_requests(submission_id);
CREATE INDEX idx_approval_requests_approver_state ON approval_requests(approver_user_id, state);
CREATE INDEX idx_submission_events_processed_at ON submission_events(processed_at, created_at);
CREATE INDEX idx_publishing_jobs_submission_id ON publishing_jobs(submission_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
