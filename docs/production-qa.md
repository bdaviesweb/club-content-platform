# Production QA Runbook

Use this runbook before a production demo, pilot walkthrough, or release handoff.

## Prerequisites

- Production VPS SSH key is available locally.
- Production VPS host is reachable as `root@5.252.55.192`.
- VPS checkout lives at `/srv/repos/projects/club-content-platform`.
- VPS has host Node available for smoke-script assertions.

## One-Command VPS Gate

Run from the repository root:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
./scripts/qa_vps.sh
```

If the VPS is already deployed to the exact commit under test, skip the deploy step:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
SKIP_DEPLOY=1 \
./scripts/qa_vps.sh
```

Expected final line:

```text
VPS weekly loop verification passed.
```

## What The Gate Covers

- API, app readiness, admin health, workflow settings, and organization directory.
- Empty approval queue baseline.
- Routing rule behavior.
- Auto-approval policy behavior.
- Club override of organization auto-approval.
- Manual approval to publish.
- Publishing destination overrides.
- Public content second approval.
- Club override of second approval.
- Event notification policy rules.
- Notification delivery status, readback, and webhook audit logging.
- Batch workflow simulation.

## Cleanup And Final State Checks

After the gate passes, confirm production is clean:

```bash
ssh -i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new root@5.252.55.192 \
  "curl -fsS http://localhost:4000/health && \
   printf '\n---READY---\n' && curl -fsS http://localhost:4000/app/readiness && \
   printf '\n---QUEUE---\n' && curl -fsS http://localhost:4000/approvals/queue && \
   printf '\n---POLICY---\n' && curl -fsS http://localhost:4000/workflow-policies/clubs/demo-soccer-club"
```

Pass criteria:

- `/health` returns `{"service":"app-api","status":"ok"}`.
- `/app/readiness` has all required demo checks marked `ok: true`.
- `/approvals/queue` returns an empty `items` array.
- `effectivePolicy.autoApproveInternalLowRisk` is `false` for `demo-soccer-club`.

If the demo club auto-approval setting needs to be restored:

```bash
curl -fsS -H 'content-type: application/json' \
  -d '{"actorEmail":"comms@demo-club.local","autoApproveInternalLowRisk":false,"autoApproveMaxRisk":0.35,"autoApprovalRule":{}}' \
  https://clubcontent-api.davmn.net/workflow-policies/clubs/demo-soccer-club
```

## Mobile Production Smoke

First run the API-only mobile smoke:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
CLEAN_SMOKE_APPROVALS=1 \
TIMEOUT_SECONDS=300 \
npm run qa:mobile
```

For a simulator-driven app pass, start Metro in another terminal:

```bash
EXPO_PUBLIC_API_BASE_URL=https://clubcontent-api.davmn.net \
npm --workspace @club/mobile run dev -- --port 8082
```

Then run:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
CLEAN_SMOKE_APPROVALS=1 \
RUN_SIMULATOR_SMOKE=1 \
EXPO_URL='exp://127.0.0.1:8082' \
TIMEOUT_SECONDS=300 \
npm run qa:mobile
```

Expected mobile result:

- A `mobile-demo-post-*` submission is created from the app.
- The review action approves the created item.
- The item reaches `published`.
- The approval queue is empty afterward.

## Current Known Production Posture

- Email delivery is intentionally log-only without a Resend API key.
- Push delivery is intentionally disabled unless production push credentials are configured.
- Notification smoke pass criteria verify skipped delivery reasons and webhook audit behavior, not real outbound delivery.

## Local Simulator Seed

When running the simulator organization reset from the host machine, use the localhost database URL after starting Colima and local support services:

```bash
colima start
docker compose up -d postgres redis minio
DATABASE_URL='postgres://club:club@localhost:5432/club_content' npm run pilot:simulator-state
```

Expected result:

- `simulator_org_reset=ok`
- `simulator_org_validate=ok`
