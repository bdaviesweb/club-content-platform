# Pilot Readiness Evidence: 2026-07-17

This records the technical readiness pass run against the hosted VPS and local simulator seed on 2026-07-17.

## Hosted VPS Scenario Suite

Command:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
npm run pilot:vps
```

Result: passed.

Covered scenarios:

- Human review to publish baseline.
- Organization default auto-approval with club override fallback.
- Organization second approval with club override bypass.
- Organization notification defaults with club override replacement.

Representative evidence:

- Review/publish smoke reached `status=published` and `final_queue_count=0`.
- Organization auto-approval published low-risk internal content.
- Club auto-approval override forced manual review.
- Organization second approval created a secondary approval request.
- Club approval override bypassed second approval and published after primary approval.
- Notification override smoke verified policy-specific skipped delivery reasons:
  - `notification_policy_email_event_disabled`
  - `notification_policy_push_event_disabled`
  - `missing_resend_config`
  - `push_disabled`

## Mobile Production Smoke

Commands:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
CLEAN_SMOKE_APPROVALS=1 \
TIMEOUT_SECONDS=300 \
npm run qa:mobile
```

```bash
EXPO_PUBLIC_API_BASE_URL=https://clubcontent-api.davmn.net \
npm --workspace @club/mobile run dev -- --port 8082
```

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
CLEAN_SMOKE_APPROVALS=1 \
RUN_SIMULATOR_SMOKE=1 \
EXPO_URL='exp://127.0.0.1:8082' \
METRO_STATUS_URL='http://127.0.0.1:8082/status' \
TIMEOUT_SECONDS=300 \
npm run qa:mobile
```

Result: passed.

Evidence:

- API-only mobile smoke created, approved, and published a mobile QA submission.
- Simulator-driven Expo smoke created `mobile-demo-post-2026-07-17T18:59:51.485Z`.
- Simulator smoke approved submission `059219a3-17ac-4ede-9b56-f73a68422e29`.
- Published post id: `735c3ee1-3da6-4a10-a31f-4d97ae93d7d0`.
- Final approval queue count: `0`.

## Local Simulator Seed

Local Docker/Colima had to be started first:

```bash
colima start
docker compose up -d postgres redis minio
```

The host-side simulator reset needs a localhost database URL:

```bash
DATABASE_URL='postgres://club:club@localhost:5432/club_content' npm run pilot:simulator-state
```

Result: passed.

Evidence:

- `simulator_org_reset=ok`
- `simulator_org_validate=ok`
- `simulator_org_organization=north-river-youth-sports`
- `simulator_org_club=north-river-soccer-club`
- `simulator_org_admins=1`
- `simulator_org_clubs=1`

## Admin Operator Smoke

Command:

```bash
TIMEOUT_SECONDS=300 npm run qa:admin
```

Result: passed.

Evidence:

- Admin web started locally on `http://127.0.0.1:3011`.
- Created admin review smoke submission `d27fc76a-a0cf-436f-816e-76ff46b74db5`.
- Approved approval request `2335f4d1-6107-401a-a69d-538c135f8de5` through the admin web proxy.
- Published post id: `96e24f81-e50d-4bc6-af99-6031b9c78aed`.
- Final approval queue count: `0`.

## Launch Readiness Checks

North River onboarding:

```bash
npm run pilot:check-launch-readiness -- docs/pilot-onboarding-north-river-youth-sports.md
```

Result: `NO_GO`.

Remaining North River launch-evidence gaps before the worksheet was updated:

- Go-live owner signoff is missing.
- Operator demo completed is not recorded.
- Mobile review smoke completed is not recorded in the onboarding worksheet.
- Pilot VPS scenario suite completed is not recorded in the onboarding worksheet.
- Open rollout blockers are not marked clear.

After recording the 2026-07-17 evidence in `docs/pilot-onboarding-north-river-youth-sports.md`, the only remaining launch-readiness gap is human go-live owner signoff.

Demo Sports onboarding:

```bash
npm run pilot:onboarding-gaps -- docs/pilot-onboarding-demo-sports-org.md
```

Result: `NO_GO`.

Demo Sports remains a template-like worksheet with broader missing identity, ownership, delivery, rollback, and launch-evidence fields.

## Current Decision

Technical pilot readiness is green for the hosted workflow, mobile submit-review-publish path, and local simulator seed.

Launch readiness remains blocked until the North River onboarding worksheet records:

- a human go-live owner signoff.

Email and push are still accepted limitations unless production delivery credentials are added:

- Email mode: log-only.
- Push mode: disabled.
