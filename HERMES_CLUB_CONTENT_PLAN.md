# Hermes Plan: Club Content Workflow Platform

## 1. Product Positioning

Do not build a general social network first.

Build a mobile-first club content workflow product:

- Parents, players, coaches, and staff submit content from mobile.
- Hermes reviews each submission for policy, quality, privacy, and routing.
- Human approvers review only the content that needs a decision.
- Approved content is published internally and optionally pushed to external channels.

This is the lowest-risk way to ship something useful for a soccer club and expand later.

## 2. MVP Outcome

The MVP should answer one question:

Can a club reliably collect media and updates from many contributors, review them safely, and publish them quickly without a large admin burden?

If the answer is yes, then later phases can add richer feed behavior, sponsorship workflows, newsletters, and more automation.

## 3. Users And Roles

Primary roles:

- `submitter_parent`
- `submitter_player`
- `submitter_coach`
- `team_manager`
- `club_admin`
- `club_comms`
- `publisher`

Role behavior:

- Submitters can upload photos, videos, and short text.
- Coaches and team managers can approve team-scoped content.
- Club comms can approve public-facing content.
- Club admins manage policy, users, destinations, and escalations.

Important rule:

- Public posting should require either explicit approval or a very conservative auto-approve policy for low-risk content.

## 4. Core MVP Features

### Mobile

- Sign in
- Choose club/team/event
- Upload photo or video
- Add caption or notes
- Tag players if allowed
- Submit content
- Track status: `received`, `in_review`, `needs_changes`, `approved`, `rejected`, `published`
- Receive push notifications

### Admin / Minimal Web

- Approval queue
- Submission detail view
- AI review summary
- Approve / reject / request changes
- Policy settings
- Destination settings
- Role management
- Audit log

### Hermes / Backend

- Submission ingestion
- Media metadata extraction
- AI moderation
- Caption generation and rewriting
- Review routing
- Publishing orchestration
- Notifications

## 5. Non-Goals For MVP

Do not include these in v1:

- Open public comments
- Direct messaging
- Follow graph
- Full social profile system
- Reactions as a core engagement mechanic
- Autonomous public posting with no approval path
- Advanced website CMS

These features increase moderation, privacy, and support costs too early.

## 6. Hermes-Centered System Architecture

Recommended shape:

- `Mobile app`: React Native / Expo
- `Admin web`: Next.js or a lightweight internal web app
- `Hermes orchestration layer`: agents + workflows + job handling
- `API service`: thin app-facing backend
- `Database`: Postgres
- `Object storage`: S3-compatible bucket for media
- `Queue`: Redis-backed jobs or Hermes-native queueing if available in your stack
- `CDN / media delivery`: optional at MVP, useful soon after

High-level flow:

1. User uploads content from mobile.
2. API stores metadata and media.
3. Hermes emits `submission.created`.
4. Moderation and enrichment agents run.
5. Hermes decides route and approval requirements.
6. Human approves or rejects.
7. Hermes publishes internally and/or externally.
8. Hermes logs outcome and sends notifications.

## 7. Service Breakdown

Keep the system split into practical services, not microservices for their own sake.

### A. Mobile Client

Responsibilities:

- Authentication
- Media capture/upload
- Submission form
- Status tracking
- Push notification handling

Notes:

- Expo is likely the fastest path unless there is a hard reason to go fully native.
- Keep the UI narrow and operational, not “social app” polished at first.

### B. Admin Web

Responsibilities:

- Approval queue
- Filters by team, age group, risk, destination
- Review detail pages
- Policy editor
- Club settings and integrations

Notes:

- This can be a thin internal tool.
- Optimize for speed of moderation, not broad public UX.

### C. API / App Backend

Responsibilities:

- Auth/session handling
- Submission CRUD
- Upload signing
- Team/user/role lookup
- Approval actions
- Feed reads
- Notification triggers

Notes:

- Keep business workflow decisions out of the controller layer.
- Controllers should emit events into Hermes, not contain review logic.

### D. Hermes Workflow Layer

Responsibilities:

- Subscribe to domain events
- Coordinate agents
- Maintain workflow state
- Apply policy logic
- Trigger notifications and publishing jobs

This is where Hermes should be central.

### E. Data / Storage

Responsibilities:

- Postgres for transactional state
- Object storage for media
- Redis for jobs, caching, temporary dedupe keys

## 8. Domain Model

Recommended first-pass tables/entities:

- `clubs`
- `teams`
- `users`
- `memberships`
- `events`
- `submissions`
- `submission_media`
- `submission_tags`
- `review_runs`
- `review_findings`
- `approval_requests`
- `approval_actions`
- `publishing_destinations`
- `publishing_jobs`
- `published_posts`
- `notifications`
- `consents`
- `audit_logs`

Critical fields:

### `submissions`

- `id`
- `club_id`
- `team_id`
- `event_id`
- `submitted_by_user_id`
- `content_type` (`photo`, `video`, `text`, `mixed`)
- `raw_text`
- `status`
- `visibility_target` (`internal`, `public`, `sponsor_only`, `draft`)
- `risk_score`
- `routing_decision`
- `created_at`

### `review_runs`

- `id`
- `submission_id`
- `agent_name`
- `model`
- `version`
- `result_status`
- `confidence`
- `summary`
- `raw_output_json`
- `created_at`

### `approval_requests`

- `id`
- `submission_id`
- `approver_user_id`
- `approver_role`
- `state`
- `due_at`

### `publishing_jobs`

- `id`
- `submission_id`
- `destination_id`
- `state`
- `attempt_count`
- `scheduled_for`
- `result_summary`

## 9. Event Model

Use event-driven workflows from day one.

Recommended events:

- `submission.created`
- `submission.media.uploaded`
- `submission.media.processed`
- `submission.ai.moderation.completed`
- `submission.ai.enrichment.completed`
- `submission.routed`
- `submission.approval.requested`
- `submission.approved`
- `submission.rejected`
- `submission.revision.requested`
- `submission.publish.requested`
- `submission.published`
- `submission.publish.failed`

This makes Hermes orchestration much cleaner than a request-response design.

## 10. Agent Design

Use multiple narrow agents, not one general “club content agent”.

### 1. Moderation Agent

Inputs:

- submission metadata
- extracted text
- OCR if present
- image/video analysis outputs
- club policy pack

Responsibilities:

- detect profanity, harassment, bullying
- detect sexual or unsafe content
- detect privacy risk involving minors
- detect medical/injury oversharing
- detect risky personally identifying information
- detect off-brand or irrelevant content
- assign `risk_score`
- assign `review_required_reason`

Outputs:

- structured findings
- safe/unsafe/needs-human-review recommendation

### 2. Enrichment Agent

Responsibilities:

- generate clean caption options
- normalize spelling and grammar
- extract hashtags or tags if desired
- create short and long versions
- infer event/team labels where confidence is high

Outputs:

- `caption_short`
- `caption_medium`
- `caption_external`
- extracted entities

### 3. Routing Agent

Responsibilities:

- decide approval path based on:
  - team
  - submitter role
  - destination
  - risk score
  - age group
  - policy flags

Example:

- low-risk internal content -> team manager
- public content with minors -> team manager + club comms
- sponsor-facing content -> club comms

### 4. Compliance Agent

Responsibilities:

- verify consent prerequisites
- check for missing required metadata
- enforce public-posting constraints
- enforce age-group specific rules

### 5. Publishing Agent

Responsibilities:

- transform approved content to each destination format
- schedule or immediately publish
- retry transient failures
- record outbound IDs and status

### 6. Digest Agent

Not MVP critical, but high value soon after.

Responsibilities:

- generate weekly recaps
- generate sponsor summary decks
- generate “top club moments” content

## 11. Policy Engine Design

Do not bury policy entirely inside prompts.

Use a hybrid model:

- explicit deterministic rules in code
- AI classification for ambiguous content
- human approval where policy or confidence is uncertain

Examples of deterministic rules:

- if `visibility_target = public` and submitter is a player under 18, require approval
- if `content_type = video` and destination is public, require human review
- if consent is missing, block external publication
- if moderation risk exceeds threshold, escalate to club admin

This is safer and easier to audit.

## 12. Approval Workflow

Recommended approval states:

- `received`
- `screening`
- `needs_metadata`
- `needs_human_review`
- `approved_internal`
- `approved_external`
- `rejected`
- `scheduled`
- `published`
- `publish_failed`

Recommended approval UX:

- AI summary at top
- visible reasons for escalation
- side-by-side media preview + generated caption
- explicit destination list
- one-tap actions: approve, reject, request revision

## 13. External Publishing Strategy

Start narrow.

Recommended order:

1. Internal club feed
2. Website news/cards
3. Email digest
4. One social destination

Do not build five fragile social integrations before proving the workflow.

For external platforms, prefer:

- create draft where possible
- or publish through a reviewed queue

This reduces reputational risk.

## 14. Mobile-First UX Notes

The app should feel like “submit and track”, not “browse forever”.

Key screens:

- login / team selection
- new submission
- media picker / capture
- caption entry
- review-before-submit
- submission status
- notifications

Optional later:

- internal feed
- saved templates
- team-specific highlights

## 15. Security And Privacy

This product touches minors, so be conservative.

Minimum requirements:

- signed uploads
- private object storage by default
- role-scoped access checks
- encrypted secrets
- audit logging for approvals and publishing
- PII minimization
- retention policy for rejected content
- admin-visible reason history

Strong recommendation:

- keep public media separated logically from private originals
- store transformed/public-safe derivatives if needed
- never treat AI decisions as sufficient evidence of safety

## 16. Dev VPS Deployment Plan

Since this is going on the dev VPS, optimize for simplicity and repeatability.

Recommended stack on the dev VPS:

- Docker Compose
- `app-api`
- `admin-web`
- `worker/hermes-runner`
- `postgres`
- `redis`
- `minio` or external S3-compatible storage
- `nginx` or Caddy for ingress/TLS

Suggested first deployment topology:

- one VPS
- one Docker Compose project
- one Postgres instance
- one Redis instance
- one object store

This is sufficient for MVP and dev testing.

### Environment Layout

- `/srv/club-content/app`
- `/srv/club-content/env`
- `/srv/club-content/data/postgres`
- `/srv/club-content/data/minio`
- `/srv/club-content/logs`

### Environment Variables

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`
- `JWT_SECRET`
- `OPENAI_API_KEY`
- `PUSH_PROVIDER_KEYS`
- `SOCIAL_PROVIDER_KEYS`
- `PUBLIC_APP_URL`
- `ADMIN_APP_URL`

### Observability

At minimum:

- structured logs
- job status dashboard
- agent run tracing
- failed publish alerts
- approval latency metrics

Track:

- submissions per day
- auto-clear rate
- escalation rate
- approval turnaround time
- publish success rate

## 17. Suggested Hermes Workflow Boundaries

Hermes should own:

- event subscriptions
- agent execution
- state transitions
- retry logic
- escalation
- publishing orchestration

The app backend should own:

- auth
- persistence APIs
- UI-facing queries
- upload/session mechanics

That separation will keep the system maintainable.

## 18. Suggested Build Phases

### Phase 0: Foundation

Goal:

Stand up the base stack on the dev VPS and prove one submission can move through the pipeline.

Deliverables:

- repo scaffold
- docker compose stack
- Postgres schema
- Redis jobs
- object storage
- auth skeleton
- submission API
- Hermes event bus integration

### Phase 1: Submission + Review MVP

Goal:

Collect content from mobile and review it safely.

Deliverables:

- mobile submission flow
- media upload
- submission status model
- moderation agent
- enrichment agent
- routing agent
- admin approval queue
- notifications

Success criterion:

- a coach or parent can submit content and an admin can approve it end to end

### Phase 2: Internal Publishing

Goal:

Publish approved content to an internal club feed.

Deliverables:

- internal feed model
- feed read APIs
- published post records
- feed surfaces in mobile and optional web

Success criterion:

- approved content appears in the club feed with audit trail

### Phase 3: External Publishing

Goal:

Push approved content to one external destination safely.

Deliverables:

- destination model
- publishing agent
- retry/failure handling
- destination-specific formatting

Success criterion:

- approved content can be published externally with review traceability

### Phase 4: Policy And Scale Hardening

Goal:

Make the workflow reliable for broader club use.

Deliverables:

- richer policy editor
- consent model improvements
- analytics
- duplicate detection
- digest agent
- sponsor workflows

## 19. Suggested First Technical Decisions

Recommended choices unless Hermes imposes stronger preferences:

- Mobile: Expo / React Native
- Admin web: Next.js
- API: Node/TypeScript
- DB: Postgres
- Queue: Redis + worker process
- Media: S3-compatible storage
- ORM: Prisma or Drizzle
- Auth: role-based auth with club/team scoping

If Hermes already has preferred worker/job conventions, follow those instead of introducing a second orchestration pattern.

## 20. Initial Backlog

First ten implementation tickets:

1. Create repo structure for mobile, admin, api, and worker
2. Stand up Docker Compose on the dev VPS
3. Add Postgres schema for clubs, teams, users, submissions, approvals
4. Add signed media upload flow
5. Add mobile submission screen and API
6. Emit `submission.created` into Hermes
7. Implement moderation agent with structured output
8. Implement routing agent and approval request creation
9. Build admin approval queue
10. Add publish-to-internal-feed workflow

## 21. Risks To Handle Early

- minors/privacy policy ambiguity
- weak consent tracking
- noisy AI false positives
- ambiguous team/event tagging
- external publishing instability
- admin approval fatigue

Best mitigations:

- conservative policies
- deterministic gating rules
- strong audit history
- narrow integration scope
- human approval for public posts

## 22. Recommended MVP Definition

If you want a realistic first release, define MVP as:

- authenticated mobile submission
- photo/video/text support
- AI moderation and caption assist
- human approval queue
- internal publishing
- one optional external destination
- notifications and audit logs

Anything beyond that should be treated as phase 2 or later.

## 23. What I Would Build Next In This Repo

If the next step is implementation, the right order is:

1. create the repo/service scaffold
2. define the schema
3. stand up local/dev VPS compose
4. implement submission ingestion
5. wire Hermes events
6. add the first moderation/routing agents
7. build the approval queue

That sequence gets you to a real vertical slice quickly.
