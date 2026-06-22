# Club Content Platform

Mobile-first club content workflow platform designed to run on Hermes-backed workflows and a dev VPS.

## Repo Layout

- `apps/mobile` - Expo / React Native client for submission and status
- `apps/admin-web` - lightweight admin and approval UI
- `apps/app-api` - thin backend API for auth, uploads, submissions, and approvals
- `apps/worker` - Hermes-oriented workflow runner and background jobs
- `packages/shared` - shared types, event names, and policy constants
- `db` - first-pass schema and seed material

## Initial Scope

The initial vertical slice is:

1. Create submission from mobile
2. Persist submission and media metadata
3. Emit `submission.created`
4. Run moderation/enrichment/routing in the worker
5. Create approval request
6. Approve from admin web
7. Publish internally

## What Works Now

The scaffold now includes a real first-pass backend flow:

- Postgres schema for submissions, reviews, approvals, publishing, audit logs, and events
- API endpoint to create a submission
- Worker polling loop that consumes `submission.created`
- Hybrid moderation and captioning flow using OpenAI when configured, with local fallback rules otherwise
- Approval request creation
- Approval action endpoint
- Internal publish on approval

This is intentionally narrow and rule-based. The Hermes-specific agent logic can now replace the stubs without changing the system boundaries.

## Dev VPS Services

The first deployment target is Docker Compose with:

- `app-api`
- `admin-web`
- `worker`
- `postgres`
- `redis`
- `minio`

For the current `hermes-dev` VPS, use `docker-compose.vps.yml` and `.env.vps`.
The planned public hosts are:

- `https://clubcontent-api.davmn.net`
- `https://clubcontent-uploads.davmn.net`

## Git And Deploy Workflow

The repo is now set up to match the other GitHub-backed projects:

- local Codex/Hermes work happens in this repo
- `origin` is GitHub
- the dev VPS runs a real git clone from `/srv/repos/projects/club-content-platform`

Useful scripts:

- `npm run dev:stack` - start API, admin, worker, and mobile web together with fixed local URLs
- `npm run dev:vps` - sync the current checkout to the verified hermes-dev VPS and check the live stack
- `npm run demo:operator` - start the operator-facing demo command center plus Expo mobile runtime, then print the one-page demo URL and Expo launch URL
- `./scripts/deploy_vps.sh` - bootstrap or force-sync the repo to the VPS
- `./scripts/update_vps.sh` - normal day-to-day flow after pushing to GitHub
- `./scripts/smoke_vps.sh` - check VPS API health, deployed admin health, approval queue, and pending workflow events from your Mac
- `./scripts/public_upload_smoke_vps.sh` - verify the public upload signing and preview path through the dev VPS ingress
- `./scripts/hermes_smoke_vps.sh` - submit a sample post, verify AI review output, and remove the sample from the active review queue
- `./scripts/notification_status_smoke_vps.sh` - assert the live dev notification delivery contract on the VPS
- `./scripts/notification_smoke_vps.sh` - verify notification readback and the latest email/push audit rows for a demo inbox
- `./scripts/notification_webhook_smoke_vps.sh` - post a sample Resend-style webhook into the dev VPS and assert it is recorded correctly
- `npm run qa:vps` - deploy the current checkout to the dev VPS, clear stale smoke approvals, and run the weekly-loop verification chain for routes, approval/publish, and notifications
- `./scripts/cleanup_smoke_approvals_vps.sh` - list old pending smoke approvals; use `APPLY=1` to move them out of the active queue
- `RUN_APPROVAL_PUBLISH_SMOKE=1 ./scripts/update_vps.sh` - update the VPS and verify submit, AI review, approval, and internal publishing
- `DETACH=1 RUN_APPROVAL_PUBLISH_SMOKE=1 ./scripts/update_vps.sh` - run a long VPS update in the background and print the log path

Recommended routine:

1. make changes locally in Codex or Hermes
2. commit and push to GitHub
3. run `npm run qa:vps` when you want one command to deploy the current checkout, clear stale smoke approvals, and verify the weekly content loop end to end
4. run `./scripts/update_vps.sh` when you only want a standard VPS update without the full smoke chain
5. run `./scripts/hermes_smoke_vps.sh` after AI review changes or VPS env updates when you want an isolated Hermes routing check
6. run `./scripts/notification_status_smoke_vps.sh` after notification config or delivery-status changes when you want the narrow delivery contract only
7. run `./scripts/notification_webhook_smoke_vps.sh` after webhook handling changes when you want only the webhook intake check

## Demo Command Center

Use `npm run demo:operator` when you want a single operator-friendly demo surface.

It will:

1. start `admin-web` on port `3013`
2. print the command-center URL and Expo launch URL
3. launch the Expo mobile app on iOS with the demo-friendly port wiring
4. keep the mobile runtime attached for the live demo

If you only want the services started in the background, run:

- `DETACH=1 npm run demo:operator`

The command center lives at:

- `http://127.0.0.1:3013/demo`

From that page you can:

- launch the mobile poster app in demo mode
- open the reviewer workspace and quick-review view
- explain backend routing and approval choices across multiple scenarios
- show the recent submission, notification, and final internal-feed output

Run `bash scripts/mobile_demo_review_smoke.sh` when you want to verify the live demo loop. The smoke now resumes a single pending `mobile-demo-post-*` review item if one is already in the queue, so a half-finished demo does not require manual cleanup before you continue.

## Pilot Launch

Use the pilot package when you want repeatable proof for customer-facing demos and first-club rollout work.

- `npm run pilot:vps`
  Runs the hosted multi-organization pilot scenario suite across baseline review/publish, auto-approval overrides, approval overrides, and notification overrides.
- `npm run pilot:audit`
  Runs a live activation audit against the current pilot candidate and returns a `GO` or `NO_GO` decision with concrete blockers.
- `PILOT_SCENARIOS=review_publish,auto_approval_override npm run pilot:vps`
  Runs only a named subset of pilot scenarios.
- [Pilot launch playbook](docs/pilot-launch.md)
  Pulls together the operator demo flow, scenario suite, onboarding checklist, QA gate, and rollout guardrails.
- [Pilot onboarding template](docs/pilot-onboarding-template.md)
  Captures the real club, role, policy, and signoff details for the first pilot.
- [Pilot activation checklist](docs/pilot-activation-checklist.md)
  Defines the go-live evidence, blockers, and recovery steps for first customer use.
- [North River onboarding packet](docs/pilot-onboarding-north-river-youth-sports.md)
  Captures the current simulated pilot org, role map, policy choices, and launch risks.
- [North River activation record](docs/pilot-activation-north-river-youth-sports.md)
  Captures the current hosted audit result and rehearsal evidence for the simulated pilot.

Current default simulator candidate:

- profile: `simulated-north-river`
- organization: `north-river-youth-sports`
- club: `north-river-soccer-club`
- team: `u13-girls-blue`
- submitter: `coach@northriverpilot.local`

Recommended rehearsal commands:

```bash
npm run pilot:profiles
```

```bash
npm run pilot:profile -- real-club-name
```

```bash
PILOT_CANDIDATE_PROFILE=simulated-north-river bash scripts/validate_pilot_candidate_profile.sh
```

```bash
npm run pilot:inspect -- simulated-north-river
```

```bash
PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit
```

```bash
PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:vps
```

```bash
npm run pilot:rehearse
```

The rehearsal writes an evidence bundle under `tmp/pilot-rehearsal/<timestamp>-<profile>/`, including a shareable `handoff.md`, and prints the go/no-go decision at the end.
Run `npm run pilot:packet` afterward to generate a single portable packet at `tmp/pilot-launch-packet.md`.
Run `npm run pilot:share` to copy that packet to `tmp/pilot-launch-packet-share.md` for handoff.
It also writes `tmp/pilot-launch-packet-share-message.txt` and copies that message body to the clipboard when `pbcopy` is available.
Run `npm run pilot:deliver` to open the ready-to-forward message body and the shared packet together.

This lets the suite keep `club_comms` for the comms lane while automatically using the team manager where a scenario routes video review to `team_manager`.

For a future real pilot handoff, run `npm run pilot:profile -- <candidate>` to scaffold `config/pilot-candidates/<candidate>.local.env`, then validate and rehearse with `PILOT_CANDIDATE_PROFILE=<candidate>`.
Use `npm run pilot:profiles` to see what candidate profiles already exist.
Use `npm run pilot:inspect -- <candidate>` to review a candidate before validation.
Use `npm run pilot:rehearse` to run the full simulator rehearsal in one pass.

`./scripts/update_vps.sh` now autostashes a dirty VPS checkout before it pulls, so a stray edit on the server no longer blocks the update.

For hosted dev work, prefer `npm run dev:vps`. It syncs the current checkout to the verified hermes-dev VPS, restarts the stack there, and prints the live URLs up front. Use `npm run dev:stack` only when you need a local fallback.

Set `CLEANUP_APPROVAL=0` on `./scripts/hermes_smoke_vps.sh` when you want the
generated AI review item to stay in the approval queue for manual inspection.

Set `CLEAN_SMOKE_APPROVALS=1` on `npm run qa:mobile` when you want the wrapper
to clear old smoke approvals before the public mobile smoke starts.

## API Endpoints

- `GET /health`
- `GET /app/readiness`
- `GET /support`
- `GET /privacy`
- `POST /submissions`
- `GET /submissions?submitterEmail=...&clubSlug=...&teamSlug=...`
- `GET /submissions/:id`
- `POST /submissions/:id/resubmit`
- `POST /uploads/sign`
- `GET /media/preview?key=uploads/...`
- `GET /approvals/queue`
- `GET /approval-requests/:id`
- `POST /approval-requests/:id/actions`
- `GET /notifications?userEmail=...`
- `GET /push-tokens?userEmail=...`
- `POST /push-tokens`
- `GET /notification-delivery/status`
- `POST /webhooks/resend`
- `POST /notifications/:id/read`
- `GET /feed/internal`
- `GET /feed/internal?includeSmoke=1` to include smoke-generated internal posts
- `GET /organizations/:slug`
- `GET /workflow-events?status=failed|pending|all`
- `POST /workflow-events/:id/retry`

### Example Submission Payload

```json
{
  "clubSlug": "demo-soccer-club",
  "teamSlug": "u14-girls",
  "submitterEmail": "coach@demo-club.local",
  "contentType": "photo",
  "rawText": "Great win today. Proud of the girls.",
  "visibilityTarget": "internal",
  "media": [
    {
      "objectKey": "uploads/example-1.jpg",
      "mediaType": "image",
      "mimeType": "image/jpeg"
    }
  ]
}
```

### Recent Submission Query

Use the list endpoint to show a submitter their latest activity in mobile:

```text
GET /submissions?submitterEmail=coach@demo-club.local&clubSlug=demo-soccer-club&teamSlug=u14-girls&limit=8
```

## Notification Delivery

Submitter workflow notifications are stored in the `notifications` table and can also be
emailed when delivery credentials are configured.

Optional environment variables:

- `RESEND_API_KEY`
- `RESEND_WEBHOOK_SECRET`
- `NOTIFICATION_FROM_EMAIL`
- `PUSH_NOTIFICATIONS_ENABLED`
- `PUSH_PROVIDER`
- `PUSH_PROJECT_ID`
- `DEMO_REVIEWER_EMAIL`
- `DEMO_SUBMITTER_EMAIL`

Push delivery now uses registered Expo push tokens when enabled. Device registrations are
still stored in `audit_logs`, which keeps the current schema stable while giving the delivery
pipeline the active tokens it needs.

Current channel split:

- in-app notifications: stored in `notifications`
- email notifications: delivered from the existing notification pipeline when Resend is configured
- push notifications: Expo push delivery when enabled, with device registrations and delivery outcomes stored in `audit_logs`

Push registration endpoints:

- `POST /push-tokens`
- `GET /push-tokens?userEmail=...`

Example push registration payload:

```json
{
  "userEmail": "coach@demo-club.local",
  "installationId": "ios-sim-1",
  "pushToken": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "platform": "ios",
  "provider": "expo",
  "appId": "com.hermes.clubcontent",
  "environment": "development",
  "deviceLabel": "Robert iPhone 15",
  "enabled": true
}
```

To disable a device later, send the same `installationId` with `enabled: false`. That
creates a new audit-log event instead of deleting history.

Readback example:

```text
GET /push-tokens?userEmail=coach@demo-club.local
```

The readback response exposes the active registration metadata plus `pushToken` and a masked
`tokenPreview` so the delivery pipeline can consume the real token without another storage layer.

Verification endpoints:

- `GET /notification-delivery/status`
- `POST /webhooks/resend`

Without those values, notifications still appear in-app and delivery attempts fall back to
log-only or skipped modes with audit log entries. If `RESEND_WEBHOOK_SECRET` is omitted, the webhook
endpoint can still parse JSON payloads in dev, but signature verification stays disabled.
Push status is also surfaced on `GET /notification-delivery/status`, including whether push
is enabled, the effective delivery `mode`, and a `reason` when delivery is intentionally
inactive or misconfigured.

Current `hermes-dev` expectation:

- email: `provider=log-only`, `enabled=false`, `mode=log-only`, `reason=missing_resend_api_key`
- push: `provider=expo`, `enabled=false`, `mode=disabled`, `reason=push_disabled`

Use `./scripts/notification_status_smoke_vps.sh` to assert that contract directly after VPS updates.

To enable Expo push delivery, set:

- `PUSH_NOTIFICATIONS_ENABLED=true`
- `PUSH_PROVIDER=expo`
- `PUSH_PROJECT_ID=<Expo/EAS project id>`

Push delivery runs from the same notification pipeline as email. Delivery results are written
to `audit_logs` with actions such as `notification.push.delivered`,
`notification.push.skipped`, and `notification.push.failed`.

Recommended Resend webhook events:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.bounced`
- `email.complained`
- `email.failed`
- `email.suppressed`

VPS enablement steps:

1. Copy `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and `NOTIFICATION_FROM_EMAIL` into `.env.vps`.
2. Set `DEMO_SUBMITTER_EMAIL` to a real inbox you control. Keep `EXPO_PUBLIC_SUBMITTER_EMAIL` aligned with the same address if you are using the mobile demo client.
3. Set `DEMO_REVIEWER_EMAIL` if you also want approval-side emails to land in a real inbox.
4. Redeploy or restart `app-api` so bootstrap re-applies the demo membership emails.
5. Create or update a submission and let the worker emit the notification email.
6. Create or update a Resend webhook to `https://clubcontent-api.davmn.net/webhooks/resend`.
7. Subscribe it to the recommended email events above.
8. Run `./scripts/notification_status_smoke_vps.sh` to confirm the live delivery status contract before deeper notification checks.
9. Run `./scripts/notification_smoke_vps.sh` after a real demo submission creates at least one notification for the target inbox.
10. Confirm `GET /notification-delivery/status` reports the expected provider, mode, enabled state, and webhook configuration for that environment.
11. Run `./scripts/notification_webhook_smoke_vps.sh` to confirm webhook intake and delivery-state propagation:
    in inactive dev mode it records an unmatched `notification.email.webhook.*` audit row, and in live Resend mode it matches the latest delivered notification and asserts `GET /notifications` surfaces the new delivery status.

For the current dev VPS, step 10 should match the inactive dev contract above unless you intentionally turn on a real delivery channel.

Incoming webhook events are written to `audit_logs` and surfaced on `GET /notifications` as
`deliveryStatus`, `deliveryProviderId`, and `deliveryUpdatedAt`.

`app-api` bootstrap treats the demo submitter and reviewer as env-driven identities for the
seeded demo club/team. On startup it will:

- create the demo users if they do not exist
- update the existing seeded user email in place when possible, so old demo submissions stay attached
- switch the seeded `submitter_coach` or `club_comms` membership to the env-configured inbox when the target email already belongs to another user

### Example Upload Signing Payload

```json
{
  "clubSlug": "demo-soccer-club",
  "files": [
    {
      "filename": "team-photo.jpg",
      "mimeType": "image/jpeg",
      "mediaType": "image"
    }
  ]
}
```

### Example Approval Action Payload

```json
{
  "action": "approve",
  "actedByEmail": "comms@demo-club.local",
  "notes": "Safe for the internal feed."
}
```

## Running It

1. Copy `.env.example` to `.env` if you want environment-specific values.
2. Start the stack with `docker compose up --build`.
3. Create a submission with `POST /submissions`.
4. Or request a real object-storage upload URL with `POST /uploads/sign`.
4. Wait for the worker to create an approval request.
5. Read `GET /approvals/queue`.
6. Approve with `POST /approval-requests/:id/actions`.
7. Read the submission again to confirm it reaches `published`.
8. Open `http://localhost:3002` to use the admin review console.
9. If `ADMIN_BASIC_AUTH_USER` and `ADMIN_BASIC_AUTH_PASSWORD` are set, the review console requires HTTP Basic Auth.

Against the VPS, run `TIMEOUT_SECONDS=300 ./scripts/approval_publish_smoke_vps.sh`
after review or publishing changes to verify the full submission, AI review,
approval, and internal publish chain.

The worker review provider now routes through `REVIEW_PROVIDER_MODE`:

- `auto` (default): Hermes first when configured, then OpenAI, then local rules
- `disabled`: skip external review providers and use local rules
- `log_only`: record provider availability but skip external review calls
- `fallback_only`: always use local rules
- `hermes_only`: use Hermes when configured, otherwise local rules
- `openai_only`: use OpenAI when configured, otherwise local rules

For hosted dev work, keep `REVIEW_PROVIDER_MODE=auto` and point Hermes at the
local Ollama instance on the VPS for a free, reliable review path:

```env
REVIEW_PROVIDER_MODE=auto
HERMES_REVIEW_AGENT_URL=http://172.21.0.1:11434/api/generate
HERMES_REVIEW_AGENT_MODE=ollama_generate
HERMES_REVIEW_AGENT_NAME=llama3.2:3b-instruct-q4_K_M
HERMES_REVIEW_AGENT_NUM_CTX=8192
HERMES_REVIEW_AGENT_NUM_PREDICT=320
```

The `172.21.0.1` address is the Docker bridge host address used by the worker
container to reach Ollama on the VPS. The worker sends a JSON-format generation
request and normalizes the returned review JSON.

The default `HERMES_REVIEW_AGENT_MODE=review_agent` expects a custom review
endpoint with this request body:

```json
{
  "agent": "club-content-review-agent",
  "version": "0.1.0",
  "input": {
    "rawText": "Submission caption text",
    "visibilityTarget": "internal",
    "contentType": "photo",
    "submitterName": "Demo Coach"
  }
}
```

The agent response may return the review fields at the top level, under
`review`, or under `output`. The worker reads `risk_level`, `confidence`,
`summary`, `caption_draft`, `review_required_reason`, and `findings`.

For the Hermes gateway's OpenAI-compatible API, set
`HERMES_REVIEW_AGENT_MODE=responses_api`, point `HERMES_REVIEW_AGENT_URL` at
`/v1/responses`, set `HERMES_REVIEW_AGENT_NAME` to the Hermes model/profile
name, and set `HERMES_REVIEW_AGENT_API_KEY` to the gateway `API_SERVER_KEY`.
The worker will send a review prompt and normalize the returned JSON.

In `auto` mode, if Hermes is not configured and `OPENAI_API_KEY` is set, the
worker uses:

- `POST /v1/moderations` for safety classification
- `POST /v1/responses` for structured review and caption drafting

If neither provider is configured, or if the selected mode disables them, the
worker falls back to local rule-based review so the flow still works in dev.

## Workflow Recovery

Failed worker events can now be inspected and retried without touching the database directly:

- `GET /workflow-events?status=failed`
- `POST /workflow-events/:id/retry`

The admin console also includes a workflow recovery panel for retrying failed events.

### Dev server reviewer access

The VPS-hosted reviewer console listens on port `3002` and is intended to stay private.

Use an SSH tunnel from your machine:

```bash
ssh -L 43002:localhost:3002 hermes-dev
```

Then open `http://localhost:43002`. If admin basic-auth credentials are configured on the VPS, your browser will prompt for them before loading the queue.

## Media Uploads

The API now supports presigned object-storage uploads through `POST /uploads/sign`.

Public metadata pages are also available from the API host:

- `GET /support`
- `GET /privacy`

Current behavior:

- ensures the configured S3/MinIO bucket exists at API startup
- returns a presigned `PUT` URL
- returns the `objectKey` to include later in `POST /submissions`

This is the backend contract the mobile client should use for real media uploads.

## Next Build Order

1. Replace rule-based moderation with a Hermes agent call
2. Add signed upload flow and real object storage writes
3. Add richer approval UI in `admin-web`
4. Add destination-specific publishing adapters
5. Add real mobile client screens in `apps/mobile`
