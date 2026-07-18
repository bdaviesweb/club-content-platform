# North River Demo Evidence: 2026-07-18

This records the first operator rehearsal using `docs/pilot-demo-script-north-river-2026-07-18.md`.

## Screenshots

Screenshots are saved under:

`tmp/demo-screenshots/2026-07-18-north-river/`

Captured screens:

- `01-demo-command-center.png`
- `02-quick-review.png`
- `03-workflow-settings.png`

The in-app browser could not reach the host loopback address, so screenshots were captured with `npx playwright screenshot` against the same local operator server.

## Operator Surface

Started admin/operator surface against the hosted API:

```bash
API_BASE_URL=https://clubcontent-api.davmn.net EXPO_URL=exp://127.0.0.1:8082 MOBILE_STATUS_URL=http://127.0.0.1:8082/status PORT=3013 node apps/admin-web/server.js
```

Verified locally:

- Demo command center rendered.
- Quick review rendered.
- Workflow settings rendered for `north-river-soccer-club` in simulator organization mode.

## Admin Smoke

Command:

```bash
TIMEOUT_SECONDS=300 npm run qa:admin
```

Result: passed.

Evidence:

- Submission id: `798c965b-bc95-4f6d-bb12-8288de1be4ef`
- Approval request id: `d2fc3f7c-c051-45eb-8a8f-ec0b08b8f7d5`
- Published post id: `225ed77d-3bf6-4b8f-81ec-eb2f5e7afd13`
- Published at: `2026-07-18T14:58:18.681Z`
- Final queue count: `0`

## Mobile API Smoke

Command:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
CLEAN_SMOKE_APPROVALS=1 \
TIMEOUT_SECONDS=300 \
npm run qa:mobile
```

Result: passed.

Evidence:

- Submission id: `a0188ba2-e6ff-466e-9f4c-a71598cf851d`
- Approval request id: `f6b4b4d2-f6ad-4985-969f-eaa34a052c40`
- Published at: `2026-07-18T14:58:23.687Z`
- Destination: `Internal Club Feed`
- Final queue count: `0`

## Final State

- Production API health: `ok`
- Approval queue: empty
- Launch readiness remained `GO`
- Onboarding gaps remained `0`

Accepted limitations remain unchanged:

- Email delivery is log-only.
- Push delivery is disabled.
- North River is still using simulated-local identities for the rehearsal.
