# Pilot Candidate Handoff

Use this package when we are preparing the first real pilot candidate but have not created real organization, club, team, or account records yet.

The goal is to leave the next operator with one safe path:
define the candidate, prove the profile is no longer template data, capture ownership and rollback decisions, and stop before any real environment mutation happens.

Start with [pilot-real-candidate-intake.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-real-candidate-intake.md) so the candidate profile, creation plan, ownership, and rollback data all come from one intake artifact.

## Safe Before Real Data Exists

These steps are safe before any real candidate records are created:

1. Start from `npm run pilot:scaffold-onboarding -- /absolute/path/to/validated-simulator-onboarding.md /absolute/path/to/real-pilot-onboarding.md` if you want a near-filled worksheet with carried-forward policy defaults, then finish the real blanks.
2. Run `npm run pilot:onboarding-gaps -- /absolute/path/to/pilot-onboarding.md` to see the remaining real-world blanks grouped by category.
3. Run `npm run pilot:intake-from-onboarding -- /absolute/path/to/pilot-onboarding.md` and save the output as the candidate intake block, or use `npm run pilot:prepare-from-onboarding -- /absolute/path/to/pilot-onboarding.md` for the full local prep path.
4. Run `npm run pilot:profile-from-intake` if you did not use the full onboarding prep path.
5. Run `npm run pilot:inspect -- <candidate-name>` to review the resolved values.
6. Run `PILOT_CANDIDATE_PROFILE=<candidate-name> bash scripts/validate_pilot_candidate_profile.sh` as the profile preflight gate.
7. Run `npm run pilot:create-plan -- <candidate-name>` to generate the exact create and rollback SQL without mutating anything yet.
8. Run `npm run pilot:readiness -- <candidate-name>` to confirm the intake, profile, handoff packet, and creation bundle all agree.
9. Fill out the ownership and rollback plan in [pilot-activation-checklist.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-activation-checklist.md).
10. Keep using the test-tenant operator kit for demos, policy walkthroughs, and rehearsal storytelling.

## Not Safe Before Real Data Exists

Do not treat these as candidate-ready pre-creation steps:

1. `PILOT_CANDIDATE_PROFILE=<candidate-name> npm run pilot:audit`
2. `PILOT_CANDIDATE_PROFILE=<candidate-name> npm run pilot:vps`
3. `PILOT_CANDIDATE_PROFILE=<candidate-name> npm run pilot:rehearse`
4. Any hosted smoke that expects the real organization, club, team, or reviewer accounts to exist already

Until those records exist, keep running the test-tenant candidate for proof:

1. `PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:audit`
2. `PILOT_CANDIDATE_PROFILE=simulated-north-river npm run pilot:vps`
3. `npm run pilot:rehearse`
4. `npm run demo:pilot`

## Candidate Preflight Sequence

Use this exact order for the handoff:

1. Scaffold the candidate profile.
2. Scaffold or copy the onboarding worksheet from a validated simulator packet if that is the fastest path.
3. Replace every template or blank real-world value.
4. Inspect the resolved profile.
5. Run the profile preflight validator.
6. Generate the creation plan and review both the create SQL and rollback SQL.
7. Capture the real people behind `team_manager`, `club_comms`, `club_admin`, submitter, and escalation owner.
8. Record the initial policy posture:
   - inherit organization defaults
   - planned club exceptions
   - notification posture
   - public-content second approval posture
9. Record the rollback owner and the exact rollback trigger.

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
5. The test-tenant demo and test-tenant rehearsal remain green.
6. Everyone agrees that the next step is real data creation, not more test-tenant prep.
