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

- `./scripts/deploy_vps.sh` - bootstrap or force-sync the repo to the VPS
- `./scripts/update_vps.sh` - normal day-to-day flow after pushing to GitHub
- `./scripts/smoke_vps.sh` - check VPS API health and approval queue from your Mac

Recommended routine:

1. make changes locally in Codex or Hermes
2. commit and push to GitHub
3. run `./scripts/update_vps.sh`
4. run `./scripts/smoke_vps.sh`

## API Endpoints

- `GET /health`
- `POST /submissions`
- `GET /submissions?submitterEmail=...&clubSlug=...&teamSlug=...`
- `POST /uploads/sign`
- `GET /submissions/:id`
- `GET /approvals/queue`
- `GET /approval-requests/:id`
- `POST /approval-requests/:id/actions`
- `GET /notifications?userEmail=...`
- `POST /notifications/:id/read`
- `GET /feed/internal`
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
8. Open `http://localhost:3001` to use the admin review console.

If `OPENAI_API_KEY` is set, the worker uses:

- `POST /v1/moderations` for safety classification
- `POST /v1/responses` for structured review and caption drafting

If no API key is set, the worker falls back to local rule-based review so the flow still works in dev.

## Workflow Recovery

Failed worker events can now be inspected and retried without touching the database directly:

- `GET /workflow-events?status=failed`
- `POST /workflow-events/:id/retry`

The admin console also includes a workflow recovery panel for retrying failed events.

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
