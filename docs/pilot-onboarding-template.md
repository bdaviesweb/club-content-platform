# Pilot Club Onboarding Template

Use this worksheet when preparing the first real club for Club Content.

## Club Identity

- Candidate profile name:
- Organization name:
- Organization slug:
- Club name:
- Club slug:
- Team names and slugs:
- Age group:
- Primary launch date:

## People and Roles

- Executive sponsor:
- Day-to-day club lead:
- Launch decision owner:
- Day-one operator:
- Submitter accounts:
- Reviewer accounts:
- Escalation contact:

Map real people to the workflow roles:

- `organization_admin`:
- `team_manager`:
- `club_comms`:
- `club_admin`:
- Optional second approver:

Record the real names used to create the first pilot users:

- Submitter name and email:
- Organization admin name and email:
- Club admin name and email:
- Club comms reviewer name and email:
- Team manager reviewer name and email:

## Workflow Policy Decisions

- Default approver role:
- Public-content approver role:
- Medium-risk approver role:
- Allow Hermes agent routing: yes / no
- Auto-approve low-risk internal content at organization level: yes / no
- Auto-approve low-risk internal content at club effective level: yes / no
- Auto-approve max risk threshold:
- Allowed auto-approval content types:
- Should the club inherit org defaults unless explicitly noted: yes / no

## Approval and Publishing Rules

- Organization routing rule for `video`:
- Club effective routing rule for `video`:
- Organization public-content second approval: yes / no
- Organization second approver role:
- Organization second-approval content types:
- Club effective public-content second approval: yes / no
- Internal destinations:
- Public destinations:

## Notification Decisions

- Require real email delivery for launch: yes / no
- Require real push delivery for launch: yes / no
- Organization notification default: `email=true`, `push=true`
- Club effective notification baseline: `email=false`, `push=false`
- Notification posture on day one:
- Known delivery limitations or accepted gaps:

## Demo and QA Evidence

- Operator demo completed:
- Mobile review smoke completed:
- Pilot VPS scenario suite completed:
- Open rollout blockers:
- Go-live owner signoff:

## Rollback Plan

- Rollback owner:
- Rollback trigger:
- First override to remove if pilot behavior is wrong:
- Scenarios to rerun after rollback:
- Pilot-club communication owner:

## Intake Export

When the worksheet is filled, convert it into the real-candidate intake block with:

1. `npm run pilot:validate-onboarding -- /absolute/path/to/pilot-onboarding.md`
2. `npm run pilot:intake-from-onboarding -- /absolute/path/to/pilot-onboarding.md`
3. Save that output to `docs/pilot-real-candidate-intake.txt` or another local text file
4. Run `npm run pilot:prepare-from-intake -- /absolute/path/to/intake.txt`

Or run the whole local prep sequence in one command:

1. `npm run pilot:prepare-from-onboarding -- /absolute/path/to/pilot-onboarding.md`
