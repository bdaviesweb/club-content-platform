# Pilot Club Onboarding: North River Youth Sports

Last verified: 2026-06-20

This worksheet is filled from the current hosted dev environment at `https://clubcontent-api.davmn.net`, the live VPS database for memberships, and the hosted rehearsal suite run against the simulated pilot candidate.

## Club Identity

- Candidate profile name: `north-river-soccer-club-pilot`
- Organization name: `North River Youth Sports`
- Organization slug: `north-river-youth-sports`
- Club name: `North River Soccer Club`
- Club slug: `north-river-soccer-club`
- Team names and slugs: `U13 Girls Blue` / `u13-girls-blue`
- Age group: `U13`
- Primary launch date: not scheduled yet

## People and Roles

- Executive sponsor: `Nora Operations` <`ops@northriverpilot.local`>
- Day-to-day club lead: `Casey Admin` <`admin@northriverpilot.local`>
- Launch decision owner: `Nora Operations`
- Day-one operator: `Casey Admin`
- Submitter accounts: `Avery Coach` <`coach@northriverpilot.local`>
- Reviewer accounts:
  - `Jordan Manager` <`manager@northriverpilot.local`>
  - `Riley Comms` <`comms@northriverpilot.local`>
  - `Casey Admin` <`admin@northriverpilot.local`>
- Escalation contact: `Nora Operations` <`ops@northriverpilot.local`>

Current live role map:

- `team_manager`: `manager@northriverpilot.local`
- `club_comms`: `comms@northriverpilot.local`
- `club_admin`: `admin@northriverpilot.local`
- Optional second approver: `admin@northriverpilot.local`
- Organization admin: `ops@northriverpilot.local`
- Submitter name and email: `Avery Coach` <`coach@northriverpilot.local`>
- Organization admin name and email: `Nora Operations` <`ops@northriverpilot.local`>
- Club admin name and email: `Casey Admin` <`admin@northriverpilot.local`>
- Club comms reviewer name and email: `Riley Comms` <`comms@northriverpilot.local`>
- Team manager reviewer name and email: `Jordan Manager` <`manager@northriverpilot.local`>

## Workflow Policy Decisions

- Default approver role: `team_manager`
- Public-content approver role: `club_comms`
- Medium-risk approver role: `club_comms`
- Allow Hermes agent routing: `yes`
- Auto-approve low-risk internal content at organization level: `yes`
- Auto-approve low-risk internal content at club effective level: `no`
- Auto-approve max risk threshold: `0.35`
- Allowed auto-approval content types: `photo`
- Should the club inherit org defaults unless explicitly noted: `yes`

## Approval and Publishing Rules

- Organization routing rule for `video`: `club_admin`
- Club effective routing rule for `video`: `team_manager`
- Organization public-content second approval: `yes`
- Organization second approver role: `club_admin`
- Organization second-approval content types: `video`
- Club effective public-content second approval: `no`
- Internal destinations: `internal_feed`
- Public destinations: `internal_feed`

## Notification Decisions

- Require real email delivery for launch: `no`
- Require real push delivery for launch: `no`
- Organization notification default: `email=true`, `push=true`
- Organization event-specific review-start posture: `submission_review_started.email=false`, `submission_review_started.push=false`
- Club effective notification baseline: `email=false`, `push=false`
- Club override notification replacement used in rehearsal: `email=true`, `push=true`
- Current delivery backend status:
  - email mode: `log-only`
  - email reason: `missing_resend_api_key`
  - push mode: `disabled`
  - push reason: `push_disabled`
- Known delivery limitations or accepted gaps:
  - live email provider credentials are not configured
  - live push delivery is disabled
  - notification policy behavior is verified, but real delivery is not yet production-ready
- Notification posture on day one: `log-only with manual verification`

## Current Override Posture

The live club currently overrides four organization areas:

1. Low-risk internal auto-approval
2. Routing rule
3. Approval rule
4. Notification rule

## Reviewer Action Notes

The simulated pilot uses three distinct approval actors. Rehearsals should use the actor that matches the routed role:

1. `manager@northriverpilot.local` for `team_manager` approval requests
2. `comms@northriverpilot.local` for `club_comms` approval requests
3. `admin@northriverpilot.local` for `club_admin` approvals and second-approval cleanup

## Launch Risks

1. Email delivery is still `log-only` because the Resend API key is missing.
2. Push delivery is still disabled because no push provider is configured.
3. This remains a simulated customer environment with local-only identities, not a real club rollout.

## Rollback Plan

- Rollback owner: `Nora Operations`
- Rollback trigger: `wrong reviewer routing or unexpected publish behavior`
- First override to remove if pilot behavior is wrong: `organization default auto-approval`
- Scenarios to rerun after rollback: `submit photo, submit video, approve, publish`
- Pilot-club communication owner: `Casey Admin`
