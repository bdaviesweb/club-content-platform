# Club Content Pilot Launch Playbook

This playbook packages the current Club Content demo and workflow-policy checks into a repeatable pilot-readiness flow.

Current default test tenant:

- Organization: `north-river-youth-sports`
- Club: `north-river-soccer-club`
- Team: `u13-girls-blue`
- Profile: `simulated-north-river`
- Activation record: [pilot-activation-north-river-youth-sports.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-activation-north-river-youth-sports.md)
- Onboarding packet: [pilot-onboarding-north-river-youth-sports.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-onboarding-north-river-youth-sports.md)

## What This Proves

The pilot package is meant to prove four things before first customer use:

1. The product can be demoed end to end from a single operator-friendly surface.
2. Organization defaults and club exceptions both affect routing, approvals, notifications, and auto-approval the way we expect.
3. A new operator can run the product and QA flow with explicit steps instead of tribal knowledge.
4. Rollout has clear guardrails for pilot clubs, fallback actions, and proof points.

## Pilot Package

Use these entry points:

1. `npm run demo:pilot`
   Boots local demo dependencies when available, runs the test-tenant org reset, starts the operator surfaces, opens the key URLs, and writes a timestamped bundle under `tmp/pilot-demo/`.
2. `npm run demo:operator`
   Starts the local operator-facing demo command center and Expo runtime.
3. `npm run pilot:test-tenant`
   Prepares the non-customer test tenant by rebuilding the fake candidate artifacts and refreshing the simulator organization when the local stack is running. Use this when you do not have a real club or team yet.
4. `bash scripts/mobile_demo_review_smoke.sh`
   Verifies the live submitter-to-reviewer-to-publish mobile flow. It can resume a pending `mobile-demo-post-*` item.
5. `npm run pilot:rehearse`
   Runs the test-tenant profile inspection, validation, hosted audit, hosted VPS rehearsal, and demo UI check in one pass. It writes an evidence bundle under `tmp/pilot-rehearsal/<timestamp>-<profile>/` with `summary.txt`, `handoff.md`, command logs, step logs, and a go/no-go decision.
6. `npm run pilot:simulator-state`
   Resets the committed test-tenant organization to the canonical North River baseline and validates the org, club, workflow policy, routing, approvals, and directory state in one command.
7. `npm run pilot:packet`
   Turns the latest rehearsal bundle into a single portable markdown packet at `tmp/pilot-launch-packet.md`.
8. `npm run pilot:share`
   Copies the portable packet to `tmp/pilot-launch-packet-share.md`, writes a ready-to-forward message body, and copies it to the clipboard when `pbcopy` is available.
9. `npm run pilot:deliver`
   Opens the ready-to-forward message body and shared packet together so the operator can hand it off without assembling anything manually.
10. `workflow-settings?organizationMode=simulator`
   Opens the committed test-tenant organization in workflow settings so we can rehearse organization defaults, club exceptions, routing rules, and auto-approvals without real clubs or candidates.
11. `docs/pilot-onboarding-template.md`
   Captures the first-club role map, policy choices, and signoff fields.
12. `docs/pilot-operator-checklist.md`
   One-page setup checklist that pairs each operator command with the expected success signal or artifact.
13. `docs/pilot-activation-checklist.md`
   Defines the go-live gate, evidence to save, and recovery steps.
14. `docs/pilot-candidate-handoff.md`
   Separates safe pre-creation candidate prep from the hosted checks that only make sense after real records exist.
15. `npm run pilot:handoff-packet -- <candidate>`
   Generates one candidate handoff packet that combines profile status, test-tenant evidence references, ownership prompts, and rollback prompts before real records exist.
16. `npm run pilot:create-plan -- <candidate>`
   Generates the exact create and rollback SQL plan for the candidate profile without mutating hosted data yet.
17. `docs/pilot-real-candidate-execution.md`
   Defines the exact hosted creation order once the candidate packet and SQL plan are approved.
18. `docs/pilot-real-candidate-intake.md`
   Captures the real candidate identity, owners, and delivery posture in the exact shape needed for hosted creation.
19. `npm run pilot:profile-from-intake`
   Generates `config/pilot-candidates/<candidate>.local.env` directly from the filled intake document.

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

### Demo Storyline

Use [pilot-demo-runbook.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-demo-runbook.md) for the exact operator sequence. It gives the happy path first, then the organization auto-approval exception, then the public-video second-approval exception, and closes on the reviewer surface plus published output.

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

Recommended test-tenant command set:

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

Reviewer-role note:

1. `review_publish` and `auto_approval_override` use `REVIEWER_EMAIL=comms@northriverpilot.local`.
2. `approval_override` now prefers `TEAM_MANAGER_REVIEWER_EMAIL` for the primary action and `CLUB_ADMIN_EMAIL` for the second-approval cleanup.
3. `notification_override` now prefers `TEAM_MANAGER_REVIEWER_EMAIL` because the simulated club routes video review to `team_manager`.

## Pilot Onboarding

Use this checklist when setting up the first real club or when rehearsing with the test tenant.

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
9. For the current test tenant, use [pilot-onboarding-north-river-youth-sports.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-onboarding-north-river-youth-sports.md) as the reference packet.
10. For a real candidate, fill out `docs/pilot-real-candidate-intake.md`.
11. Run `npm run pilot:profile-from-intake` to generate `config/pilot-candidates/<candidate>.local.env`.
12. Run `npm run pilot:inspect -- <candidate>` to review the resolved candidate profile.
13. Run `bash scripts/validate_pilot_candidate_profile.sh <path-or-profile>` as the candidate preflight gate.
14. Use `npm run pilot:profiles` to see available profiles and whether they are template, committed, or local.
15. Run `npm run pilot:create-plan -- <candidate>` and review both the create SQL and rollback SQL before any hosted mutation work starts.
16. Fill out `docs/pilot-onboarding-template.md` and `docs/pilot-activation-checklist.md` with the real owners and rollback plan before any hosted mutation work starts.
17. Use [pilot-candidate-handoff.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-candidate-handoff.md) to keep pre-creation work separate from post-creation hosted checks.
18. Keep `npm run pilot:rehearse` on the test-tenant profile until the real organization records exist.
19. Review the generated bundle under `tmp/pilot-rehearsal/<timestamp>-<profile>/` and preserve `handoff.md` for handoff.
20. Run `npm run pilot:packet` to turn the latest rehearsal bundle into a single portable launch packet.
21. Run `npm run pilot:share` to copy the packet to `tmp/pilot-launch-packet-share.md` for one-step handoff.
22. Run `npm run pilot:deliver` to open the ready-to-forward message body and shared packet together.
23. Open `/workflow-settings?organizationMode=simulator` when you want to rehearse the committed test-tenant organization without real clubs or candidates.
24. Use the generated `tmp/pilot-launch-packet-share-message.txt` as the fallback message body when clipboard copy is unavailable.

## QA Checklist

Use this before each pilot milestone:

1. `node --test apps/admin-web/server.test.js`
2. `npm --workspace @club/mobile test`
3. `bash scripts/mobile_demo_review_smoke.sh`
4. `npm run pilot:rehearse`
5. Review `docs/pilot-activation-checklist.md` and confirm every blocker is still false.

Expected evidence:

1. The demo command center loads and shows operator links plus scenario cards.
2. A mobile-created demo post reaches review and then publishes.
3. The hosted scenario suite shows both organization-default and club-override phases for each selected policy case.
4. The approval queue is not left with unexpected smoke residue after the chosen flow.
5. The reviewer identity used in each smoke step matches the routed approver role for that scenario.

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
