# Pilot Activation Checklist

Use this checklist before turning on the first real pilot club or declaring the simulated pilot package launch-ready.

## Before Activation

- Confirm the organization slug, club slug, and team slugs.
- Confirm every required reviewer account exists and has the expected role.
- Confirm each scripted approval action uses the identity that matches the routed approver role.
- Confirm the club should inherit organization defaults everywhere except explicitly approved exceptions.
- Confirm publishing destinations for internal and public content.
- Confirm whether email and push delivery are expected, optional, or intentionally disabled for the pilot.

## Verification Gates

- `node --test apps/admin-web/server.test.js`
- `npm --workspace @club/mobile test`
- `bash scripts/mobile_demo_review_smoke.sh`
- `npm run pilot:vps`
- `npm run pilot:audit`
- `npm run pilot:rehearse`
- `npm run pilot:packet`
- `npm run pilot:share`

## Evidence to Capture

- Demo command center URL used:
- Rehearsal bundle path:
- Rehearsal handoff file:
- Rehearsal launch packet:
- Rehearsal share packet:
- Rehearsal go/no-go summary:
- Mobile submission id verified:
- Published post id verified:
- Pilot VPS scenarios run:
- Any scenario-specific notes:

## Rollout Blockers

Do not activate if any of these are unresolved:

- A new mobile post stays stuck at `received` without the worker eventually draining `submission.created`.
- The approval queue contains unexplained residual smoke items.
- Workflow events are failing or repeatedly staying pending without explanation.
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
