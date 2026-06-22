# Pilot Activation Checklist

Use this checklist before turning on the first real pilot club or declaring the simulated pilot package launch-ready.

## Before Activation

- Confirm the organization slug, club slug, and team slugs.
- Confirm the launch decision owner, day-one operator, and rollback owner are explicitly named.
- Confirm every required reviewer account exists and has the expected role.
- Confirm each scripted approval action uses the identity that matches the routed approver role.
- Confirm the club should inherit organization defaults everywhere except explicitly approved exceptions.
- Confirm publishing destinations for internal and public content.
- Confirm whether email and push delivery are expected, optional, or intentionally disabled for the pilot.

## Candidate Handoff Before Record Creation

- Scaffold the candidate with `npm run pilot:profile -- <candidate-name>`.
- Replace every template placeholder before expecting profile validation to pass.
- Run `npm run pilot:inspect -- <candidate-name>`.
- Run `PILOT_CANDIDATE_PROFILE=<candidate-name> bash scripts/validate_pilot_candidate_profile.sh`.
- Run `npm run pilot:handoff-packet -- <candidate-name>` and save the generated packet.
- Run `npm run pilot:create-plan -- <candidate-name>` and review the generated create/rollback SQL.
- Fill out `docs/pilot-onboarding-template.md`.
- Run `npm run pilot:intake-from-onboarding -- /absolute/path/to/pilot-onboarding.md` and save the generated intake block.
- Record the rollback trigger, rollback owner, and first override to remove if day-one behavior is wrong.
- Keep hosted audit, VPS checks, and full rehearsal on the simulator profile until the real organization records exist.

## Verification Gates

- `node --test apps/admin-web/server.test.js`
- `npm run demo:pilot`
- `npm --workspace @club/mobile test`
- `bash scripts/mobile_demo_review_smoke.sh`
- `npm run pilot:simulator-state`
- `npm run pilot:vps`
- `npm run pilot:audit`
- `npm run pilot:post-create-verify`
- `npm run pilot:rehearse`
- `npm run pilot:packet`
- `npm run pilot:share`
- `npm run pilot:deliver`

## Evidence to Capture

- Candidate profile path:
- Candidate profile preflight result:
- Candidate handoff document:
- Candidate creation plan:
- Candidate create SQL:
- Candidate rollback SQL:
- Post-creation verification bundle:
- Demo command center URL used:
- Demo bundle path:
- Rehearsal bundle path:
- Rehearsal handoff file:
- Rehearsal launch packet:
- Rehearsal share packet:
- Rehearsal share message:
- Rehearsal delivery target:
- Simulator organization mode URL used:
- Rehearsal go/no-go summary:
- Mobile submission id verified:
- Published post id verified:
- Pilot VPS scenarios run:
- Pending workflow event count during hosted audit:
- Any scenario-specific notes:

## Rollout Blockers

Do not activate if any of these are unresolved:

- A new mobile post stays stuck at `received` without the worker eventually draining `submission.created`.
- The approval queue contains unexplained residual smoke items.
- Workflow events are failing or staying pending during hosted audit without explanation.
- Notification delivery behavior does not match the chosen pilot posture.
- Reviewer roles are ambiguous or mapped to the wrong people.
- Scripted cleanup or approval actions use a reviewer identity that is not authorized for the routed role.

## First-Day Monitoring

- Check the review queue after the first real post.
- Check recent submission status transitions.
- Check internal-feed publishing results.
- Check notification delivery status.
- Record any club-specific exceptions that should become organization defaults later.

## Recovery Steps

- Clear leftover smoke approvals before repeating the demo.
- Re-run `bash scripts/mobile_demo_review_smoke.sh` to validate the live path.
- Re-run only the affected hosted scenario with `PILOT_SCENARIOS=... npm run pilot:vps`.
- Revert a questionable club override back to inherited organization defaults before making additional policy edits.
- Record which owner approved the rollback and which scenario must be rerun before the pilot resumes.
