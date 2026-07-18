# North River Pilot Demo Script

Use this for a calm, repeatable walkthrough of the signed North River pilot rehearsal.

## Demo Posture

- Candidate: `north-river-soccer-club-pilot`
- Organization: `North River Youth Sports`
- Club: `North River Soccer Club`
- Team: `U13 Girls Blue`
- API: `https://clubcontent-api.davmn.net`
- Launch packet: `docs/pilot-launch-packet-north-river-2026-07-18.md`
- Onboarding worksheet: `docs/pilot-onboarding-north-river-youth-sports.md`
- Launch state: signed and launch-ready, with hosted create SQL not yet executed from the dry-run packet.

Accepted limitations to say plainly:

- Email delivery is log-only until Resend credentials are configured.
- Push delivery is disabled until production push credentials are configured.
- North River uses simulated-local identities for this pilot rehearsal.

## Cast

- Submitter: `Avery Coach` <`coach@northriverpilot.local`>
- Team manager reviewer: `Jordan Manager` <`manager@northriverpilot.local`>
- Club comms reviewer: `Riley Comms` <`comms@northriverpilot.local`>
- Club admin and optional second approver: `Casey Admin` <`admin@northriverpilot.local`>
- Organization admin: `Nora Operations` <`ops@northriverpilot.local`>

## Preflight

Run these before showing the demo:

```bash
npm run pilot:check-launch-readiness -- docs/pilot-onboarding-north-river-youth-sports.md
npm run pilot:onboarding-gaps -- docs/pilot-onboarding-north-river-youth-sports.md
curl -fsS https://clubcontent-api.davmn.net/health
curl -fsS https://clubcontent-api.davmn.net/approvals/queue
```

Expected result:

- `pilot_launch_readiness=GO`
- `pilot_real_onboarding_gaps=GO`
- API health returns `ok`
- approval queue returns an empty `items` array

Start the operator surfaces:

```bash
API_BASE_URL=https://clubcontent-api.davmn.net npm run demo:operator
```

Keep these open:

- Demo command center: `http://127.0.0.1:3013/demo`
- Quick review: `http://127.0.0.1:3013/quick-review`
- Workflow settings: `http://127.0.0.1:3013/workflow-settings?organizationMode=simulator&clubSlug=north-river-soccer-club`

## Opening Talk Track

"This is the North River pilot rehearsal. The pilot gate is signed, the mobile and admin smokes passed, the VPS scenario suite passed, and the launch packet is generated. Today I am showing the workflow behavior and operator surfaces. Real email and push delivery are intentionally deferred, so notification checks prove policy and audit behavior rather than outbound delivery."

## Scene 1: Submitter Creates A Post

Goal: show that a coach can submit content without understanding the approval machinery.

1. Open the demo command center.
2. Open the mobile poster flow.
3. Trigger or show a post from `Avery Coach`.
4. Use a simple internal photo example first.

Say:

"Avery creates the post as a normal team submitter. The system records the club, team, visibility, content type, and submitter. From here the workflow decides whether this should publish automatically or route to a reviewer."

Proof to show:

- A new item appears in quick review or the approval queue.
- The item shows the submitter, content, and workflow status.

## Scene 2: Reviewer Approves

Goal: show the reviewer experience and the fast path from review to publish.

1. Open quick review.
2. Select the pending item.
3. Confirm the routed reviewer role.
4. Approve the item.
5. Wait for publish completion.

Say:

"The reviewer does not need to know every policy detail. They see the content, the recommendation, and the action. Approval sends the item to the worker, and the worker publishes it to the configured destination."

Proof to show:

- Status changes from pending or human review to approved.
- Published result appears in the internal feed.
- Approval queue returns to empty.

## Scene 3: Workflow Settings Explain The Why

Goal: show the operator that routing, approval, publishing, and notifications are controllable.

1. Open workflow settings for `north-river-soccer-club`.
2. Show organization defaults.
3. Show club overrides.
4. Point to these policy choices:
   - low-risk internal photo auto-approval exists at the organization level,
   - North River club effective auto-approval is off,
   - public video can require a second approval at the organization level,
   - North River club effective second approval is off,
   - notification delivery is accepted as log-only or disabled.

Say:

"The important idea is inheritance with exceptions. The organization can set sane defaults, and a club can override the few areas where local operations need different behavior."

Do not over-explain every field. Stop when the audience understands defaults versus exceptions.

## Scene 4: Exceptions

Goal: show that the system can handle the cases that usually create manual process.

Auto-approval exception:

1. Explain that organization policy can auto-approve low-risk internal photos.
2. Show that North River can choose manual review instead.
3. Tie this to launch safety: the club starts conservative while still inheriting other defaults.

Second-approval exception:

1. Explain that public video can require a second approval.
2. Show the club override that removes second approval for this rehearsal.
3. Say that this can be changed later if the club wants stricter public-content controls.

Notification exception:

1. Show notification posture.
2. State that real outbound delivery is deferred.
3. Explain that audit logs still prove what would have been delivered or skipped.

## Scene 5: Closeout

Show:

- launch packet,
- onboarding worksheet,
- readiness result,
- empty approval queue.

Say:

"The pilot is ready as a signed rehearsal with accepted delivery limitations. The next operational decision is whether to execute hosted create SQL for the pilot lane or keep this as a dry-run launch packet until real-club identity and delivery choices are finalized."

## Recovery Notes

If a smoke item remains in the queue:

```bash
SSH_OPTS='-i /Users/robertdavies/.ssh/clubhq_contabo_ed25519 -o StrictHostKeyChecking=accept-new' \
REMOTE_HOST='root@5.252.55.192' \
APPLY=1 \
./scripts/cleanup_smoke_approvals_vps.sh
```

If the launch is executed and needs rollback:

```bash
PILOT_CANDIDATE_PROFILE=north-river-soccer-club-pilot npm run pilot:apply-sql -- north-river-soccer-club-pilot rollback
```

If the operator surfaces are stale:

```bash
npm run demo:runtime:stop
API_BASE_URL=https://clubcontent-api.davmn.net npm run demo:operator
```

## Success Criteria

- Audience understands submitter, reviewer, admin, and operator roles.
- One submitted post reaches published state.
- Workflow settings explain why routing and approval behaved as shown.
- Email and push limitations are stated as accepted launch posture.
- The demo ends with an empty approval queue.
