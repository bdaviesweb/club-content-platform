# Pilot Candidate Handoff

Use this package when we are preparing the first real pilot candidate but have not created real organization, club, team, or account records yet.

The goal is to leave the next operator with one safe path:
define the candidate, prove the profile is no longer template data, capture ownership and rollback decisions, and stop before any real environment mutation happens.

Start with [pilot-real-candidate-intake.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-real-candidate-intake.md) so the candidate profile, creation plan, ownership, and rollback data all come from one intake artifact.

## Safe Before Real Data Exists

These steps are safe before any real candidate records are created:

1. Fill out `docs/pilot-real-candidate-intake.md`.
2. Run `npm run pilot:profile-from-intake`.
3. Run `npm run pilot:inspect -- <candidate-name>` to review the resolved values.
4. Run `PILOT_CANDIDATE_PROFILE=<candidate-name> bash scripts/validate_pilot_candidate_profile.sh` as the profile preflight gate.
5. Run `npm run pilot:create-plan -- <candidate-name>` to generate the exact create and rollback SQL without mutating anything yet.
6. Run `npm run pilot:readiness -- <candidate-name>` to confirm the intake, profile, handoff packet, and creation bundle all agree.
7. Fill out [pilot-onboarding-template.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-onboarding-template.md).
8. Fill out the ownership and rollback plan in [pilot-activation-checklist.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-activation-checklist.md).
9. Keep using the simulator operator kit for demos, policy walkthroughs, and rehearsal storytelling.

## Not Safe Before Real Data Exists

Do not treat these as candidate-ready pre-creation steps:

1. `PILOT_CANDIDATE_PROFILE=<candidate-name> npm run pilot:audit`
2. `PILOT_CANDIDATE_PROFILE=<candidate-name> npm run pilot:vps`
3. `PILOT_CANDIDATE_PROFILE=<candidate-name> npm run pilot:rehearse`
4. Any hosted smoke that expects the real organization, club, team, or reviewer accounts to exist already

Until those records exist, keep running the simulator candidate for proof:

1. `PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit`
2. `PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:vps`
3. `npm run pilot:rehearse`
4. `npm run demo:pilot`

## Candidate Preflight Sequence

Use this exact order for the handoff:

1. Scaffold the candidate profile.
2. Replace every template placeholder value.
3. Inspect the resolved profile.
4. Run the profile preflight validator.
5. Generate the creation plan and review both the create SQL and rollback SQL.
6. Capture the real people behind `team_manager`, `club_comms`, `club_admin`, submitter, and escalation owner.
7. Record the initial policy posture:
   - inherit organization defaults
   - planned club exceptions
   - notification posture
   - public-content second approval posture
8. Record the rollback owner and the exact rollback trigger.

The validator is expected to fail until the template placeholders are replaced. That failure is the safeguard, not a bug.

## Ownership to Lock Before Creation

Do not create the real candidate until these are assigned:

1. Launch decision owner
2. Day-one operator
3. Reviewer-role owners for `team_manager`, `club_comms`, and `club_admin`
4. Escalation contact for policy or publish mistakes
5. Rollback owner with authority to revert club overrides

## Rollback Plan to Lock Before Creation

Write the rollback plan before any real records are created:

1. Which club overrides can be removed immediately if the pilot behaves unexpectedly
2. Which scenarios must be re-run after a rollback
3. Who communicates the rollback to the pilot club
4. Whether notifications should be left disabled, log-only, or fully enabled on day one

## Exit Criteria

The candidate handoff is ready for the next stage only when:

1. The local candidate profile passes `validate_pilot_candidate_profile.sh`.
2. The candidate creation plan has both create and rollback SQL.
3. The onboarding worksheet is filled out.
4. The activation checklist has named owners and rollback decisions.
5. The simulator demo and simulator rehearsal remain green.
6. Everyone agrees that the next step is real data creation, not more simulator prep.
