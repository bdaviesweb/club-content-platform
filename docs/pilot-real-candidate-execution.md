# Pilot Real Candidate Execution

Use this only after the candidate handoff packet, onboarding worksheet, activation checklist, and creation plan are all complete.

This is the controlled transition from simulator prep to real candidate records.

## Required Inputs

Before running anything hosted, confirm all of these exist:

1. A filled [pilot-real-candidate-intake.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-real-candidate-intake.md) or [pilot-real-candidate-intake.txt](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-real-candidate-intake.txt)
2. A filled `config/pilot-candidates/<candidate>.local.env`
3. A passing `validate_pilot_candidate_profile.sh` result
4. A saved candidate handoff packet from `npm run pilot:handoff-packet -- <candidate>`
5. A saved creation bundle from `npm run pilot:create-plan -- <candidate>`
6. A passing `npm run pilot:readiness -- <candidate>` result
7. Named owners for launch, day-one operation, and rollback

## Execution Order

1. Fill `docs/pilot-onboarding-template.md` or a copied onboarding worksheet for the real club
2. If the real values were collected in the prep-kit reply template, apply them with `npm run pilot:apply-reply-template -- /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt`
3. Fastest preflight checkpoint: run `npm run pilot:process-reply-template -- /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt` to apply the returned answers, rerun validation, rerun the gap report, and check launch readiness in one saved bundle
4. Fastest pre-creation local prep: run `npm run pilot:prepare-from-reply-template -- /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt` to accept the returned answers and generate the intake block, profile, creation plan, and rollback-ready local bundle without touching hosted records
5. Strongest local gate before hosted work: run `npm run pilot:preflight-from-reply-template -- /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt` to generate the local bundle and confirm the candidate profile passes inspection and preflight before any hosted mutation
6. Fastest reply-template end-to-end operator path: run `npm run pilot:launch-from-reply-template -- /absolute/path/to/pilot-onboarding.md /absolute/path/to/pilot-real-data-reply-template.txt` when the worksheet, signoff, and operator window are all ready; this carries the flow from returned answers through local preflight into hosted create and hosted verification
7. Validate it with `npm run pilot:validate-onboarding -- /absolute/path/to/pilot-onboarding.md`
8. Confirm the prelaunch evidence gate with `npm run pilot:check-launch-readiness -- /absolute/path/to/pilot-onboarding.md`
9. Fastest onboarding path: run `npm run pilot:prepare-from-onboarding -- /absolute/path/to/pilot-onboarding.md` to generate the intake block, profile, handoff packet, creation plan, and readiness result in one pass
10. Fastest end-to-end operator path: run `npm run pilot:launch-from-onboarding -- /absolute/path/to/pilot-onboarding.md` to validate onboarding, confirm prelaunch evidence and signoff, prepare the candidate artifacts, apply the hosted create SQL, run hosted verification, and emit a rollback-ready bundle in one pass
11. Intake-first fast path: run `npm run pilot:prepare-from-intake -- /absolute/path/to/intake.txt` to generate the profile, handoff packet, creation plan, and readiness result in one pass
12. Manual path: run `npm run pilot:intake-from-onboarding -- /absolute/path/to/pilot-onboarding.md`, save the block, then run `npm run pilot:profile-from-intake` or `npm run pilot:profile-from-intake -- /absolute/path/to/intake.txt`
13. Run `npm run pilot:inspect -- <candidate>`
14. Run `PILOT_CANDIDATE_PROFILE=<candidate> bash scripts/validate_pilot_candidate_profile.sh`
15. Run `npm run pilot:handoff-packet -- <candidate>`
16. Run `npm run pilot:create-plan -- <candidate>`
17. Run `npm run pilot:readiness -- <candidate>` or `npm run pilot:readiness -- /absolute/path/to/intake.txt`
18. Review the generated `create.sql` and `rollback.sql`
19. Apply the `create.sql` on the hosted pilot database with an operator present, or use `PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:apply-sql -- <candidate> create`
20. Fastest hosted verification path: run `PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:post-create-verify`
21. Manual hosted verification path: run `PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:audit`
22. If audit is `GO`, run `PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:vps`
23. If the hosted scenarios pass, run the operator demo and capture evidence
24. If anything fails, stop and use the generated `rollback.sql` before making more changes, or use `PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:apply-sql -- <candidate> rollback`

## Stop Conditions

Do not continue past record creation if any of these happen:

1. `pilot:audit` returns `NO_GO`
2. Reviewer roles do not match the expected real people
3. Queue hygiene is not clean enough to separate smoke items from real items
4. Email or push posture is different from the documented pilot decision
5. The rollback owner is unavailable
6. The onboarding worksheet does not show completed demo, mobile smoke, VPS verification, blocker review, and go-live signoff

## Evidence To Save

After hosted creation, preserve:

1. The candidate profile path used
2. The handoff packet path
3. The creation plan bundle path
4. The exact `create.sql` used
5. The exact `rollback.sql` saved
6. The `pilot:post-create-verify` bundle path, if used
7. The `pilot:audit` output
8. The `pilot:vps` output
9. Any operator demo submission, approval, and publish ids
10. The hosted `pending_workflow_count` and `failed_workflow_count` from `pilot:audit`

## Rollback Trigger

Use the rollback SQL immediately if:

1. Hosted audit fails on missing or incorrect memberships
2. The wrong real people were assigned to reviewer roles
3. The real club should not continue after the first verification pass
4. The candidate was created in the wrong org, club, or team identity
