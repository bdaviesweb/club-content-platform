# Club Content Pilot Launch Playbook

This playbook packages the current Club Content demo and workflow-policy checks into a repeatable pilot-readiness flow.

## What This Proves

The pilot package is meant to prove four things before first customer use:

1. The product can be demoed end to end from a single operator-friendly surface.
2. Organization defaults and club exceptions both affect routing, approvals, notifications, and auto-approval the way we expect.
3. A new operator can run the product and QA flow with explicit steps instead of tribal knowledge.
4. Rollout has clear guardrails for pilot clubs, fallback actions, and proof points.

## Pilot Package

Use these three entry points:

1. `npm run demo:operator`
   Starts the local operator-facing demo command center and Expo runtime.
2. `bash scripts/mobile_demo_review_smoke.sh`
   Verifies the live submitter-to-reviewer-to-publish mobile flow. It can resume a pending `mobile-demo-post-*` item.
3. `npm run pilot:vps`
   Runs the hosted multi-organization workflow-policy scenario suite.
4. `docs/pilot-onboarding-template.md`
   Captures the first-club role map, policy choices, and signoff fields.
5. `docs/pilot-activation-checklist.md`
   Defines the go-live gate, evidence to save, and recovery steps.

## Operator Demo Flow

Use this when walking someone through the product live.

1. Start the operator lane with `npm run demo:operator`.
2. Open `http://127.0.0.1:3013/demo`.
3. From the command center, walk the audience through:
   - mobile poster launch
   - reviewer queue
   - backend decision cards
   - recent submission activity
   - internal feed output
   - notification output
4. Create or resume a demo post.
5. Run `bash scripts/mobile_demo_review_smoke.sh` if you want proof that the live mobile flow still works before or after the walkthrough.

## Scenario Suite

Run `npm run pilot:vps` to verify the hosted dev lane across the core pilot scenarios.

Default scenarios:

1. `review_publish`
   Proves the baseline human review and publish loop.
2. `auto_approval_override`
   Proves organization auto-approval defaults can be applied and then intentionally blocked by a club exception.
3. `approval_override`
   Proves organization second-approval requirements can be bypassed by a club exception where allowed.
4. `notification_override`
   Proves organization notification defaults can be replaced by a club override.

Use `PILOT_SCENARIOS` to narrow the suite when needed:

```bash
PILOT_SCENARIOS=review_publish,auto_approval_override npm run pilot:vps
```

## Pilot Onboarding

Use this checklist when setting up the first real club.

1. Confirm the pilot organization slug, club slug, and pilot reviewer accounts.
2. Confirm who owns each approval role:
   - `team_manager`
   - `club_comms`
   - `club_admin`
3. Confirm which content should be:
   - auto-approved
   - routed to a human reviewer
   - held for a second approval
4. Confirm internal-only versus public publishing destinations.
5. Confirm notification channels for submitters and reviewers.
6. Run the operator demo once with the pilot accounts and preserve the evidence.
7. Run the VPS scenario suite against the hosted dev lane before enabling the pilot in production-like use.
8. Fill out `docs/pilot-onboarding-template.md` and save the chosen pilot posture before enabling real users.

## QA Checklist

Use this before each pilot milestone:

1. `node --test apps/admin-web/server.test.js`
2. `npm --workspace @club/mobile test`
3. `bash scripts/mobile_demo_review_smoke.sh`
4. `npm run pilot:vps`
5. Review `docs/pilot-activation-checklist.md` and confirm every blocker is still false.

Expected evidence:

1. The demo command center loads and shows operator links plus scenario cards.
2. A mobile-created demo post reaches review and then publishes.
3. The hosted scenario suite shows both organization-default and club-override phases for each selected policy case.
4. The approval queue is not left with unexpected smoke residue after the chosen flow.

## Rollout Guardrails

Use these rules for first-customer use:

1. Keep the first pilot on the verified `hermes-dev` lane until the operator flow and scenario suite are consistently green.
2. Do not enable new policy areas for a club until the matching VPS scenario has been run after the latest config change.
3. Preserve a manual reviewer path even when auto-approval is enabled for low-risk content.
4. Prefer organization defaults first, then add club exceptions only where policy or staffing actually differs.
5. Treat pending smoke approvals, failed workflow events, or unverified notification delivery as rollout blockers.

## Rollback and Recovery

If a pilot run goes sideways:

1. Clear leftover smoke approvals before the next public demo.
2. Re-run `bash scripts/mobile_demo_review_smoke.sh` to verify the live poster-to-publish path.
3. Re-run only the affected VPS scenario with `PILOT_SCENARIOS=... npm run pilot:vps`.
4. If a club exception is causing confusion, revert to inherited organization defaults before changing multiple areas at once.
