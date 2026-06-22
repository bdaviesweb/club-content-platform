# Pilot Real Candidate Intake

Fill this out before we create the first real pilot candidate.

This document is the single source of truth for:

1. `config/pilot-candidates/<candidate>.local.env`
2. `npm run pilot:handoff-packet -- <candidate>`
3. `npm run pilot:create-plan -- <candidate>`
4. Hosted creation, audit, VPS verification, and rollback ownership

## Candidate Identity

- Candidate profile name:
- Organization name:
- Organization slug:
- Club name:
- Club slug:
- Team name:
- Team slug:
- Age group:

## Real People

- Submitter name:
- Submitter email:
- Organization admin name:
- Organization admin email:
- Club admin name:
- Club admin email:
- Club comms reviewer name:
- Club comms reviewer email:
- Team manager reviewer name:
- Team manager reviewer email:

## Ownership

- Launch decision owner:
- Day-one operator:
- Rollback owner:
- Escalation contact:

## Delivery Posture

- Require real email delivery for launch: yes / no
- Require real push delivery for launch: yes / no
- If email is not required yet, what is the accepted fallback:
- If push is not required yet, what is the accepted fallback:

## Approval and Policy Notes

- Default approver role:
- Public-content approver role:
- Medium-risk approver role:
- Should the club inherit org defaults unless explicitly noted: yes / no
- Planned club exceptions:
- Public-content second approval required: yes / no
- Notification posture on day one:

## Rollback Notes

- Rollback trigger:
- First override to remove if day-one behavior is wrong:
- Scenarios to rerun after rollback:
- Pilot-club communication owner:

## Ready-To-Paste Block

Use this exact block when sending the candidate data for creation:

You can also save this block to a local text file and run `npm run pilot:profile-from-intake -- /absolute/path/to/that-file.txt`.

If you want one file to drive the full pre-creation flow, include all of these fields and then use the same file with `npm run pilot:readiness -- /absolute/path/to/that-file.txt`.

```text
candidate_profile_name=
organization_name=
organization_slug=
club_name=
club_slug=
team_name=
team_slug=
age_group=

submitter_name=
submitter_email=

organization_admin_name=
organization_admin_email=

club_admin_name=
club_admin_email=

reviewer_name=
reviewer_email=

team_manager_name=
team_manager_email=

launch_decision_owner=
day_one_operator=
rollback_owner=
escalation_contact=

require_email_delivery=yes|no
require_push_delivery=yes|no
default_approver_role=
public_content_approver_role=
medium_risk_approver_role=
inherit_org_defaults=yes|no
public_second_approval=yes|no
notification_posture=
rollback_trigger=
first_override=
rollback_scenarios=
pilot_comms_owner=
```
