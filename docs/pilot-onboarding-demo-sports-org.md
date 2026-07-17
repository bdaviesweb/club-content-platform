# Pilot Club Onboarding: Demo Sports Organization

Last verified: 2026-06-20

This worksheet is filled from the current hosted dev environment at `https://clubcontent-api.davmn.net` plus the live VPS database for memberships.

## Club Identity

- Organization name: `Demo Sports Organization`
- Organization slug: `demo-sports-org`
- Club name: `Demo Soccer Club`
- Club slug: `demo-soccer-club`
- Team names and slugs: `u14-girls`
- Primary launch date: not scheduled yet

## People and Roles

- Executive sponsor: not assigned in current environment
- Day-to-day club lead: not assigned in current environment
- Submitter accounts: `coach@demo-club.local`
- Reviewer accounts: `comms@demo-club.local`
- Escalation contact: `org-admin@demo-club.local`

Current live role map:

- `team_manager`: not currently assigned in club memberships
- `club_comms`: `comms@demo-club.local`
- `club_admin`: `admin@demo-club.local`, `admin@demo-workspace.local`, `comms@demo-club.local`
- Optional second approver: no distinct second approver account; current public-content second approval resolves to the `club_admin` role
- Organization admin: `org-admin@demo-club.local`

## Workflow Policy Decisions

- Default approver role: `team_manager`
- Public-content approver role: `club_comms`
- Medium-risk approver role: `club_comms`
- Allow Hermes agent routing: `yes`
- Auto-approve low-risk internal content at organization level: `yes`
- Auto-approve low-risk internal content at club effective level: `no`
- Auto-approve max risk threshold: `0.35`
- Allowed auto-approval content types: `photo`

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

- Organization notification default: `email=true`, `push=true`
- Club effective notification posture: `email=false`, `push=false`
- Current delivery backend status:
  - email mode: `log-only`
  - email reason: `missing_resend_api_key`
  - push mode: `disabled`
  - push reason: `push_disabled`
- Known delivery limitations or accepted gaps:
  - live email provider credentials are not configured
  - live push delivery is disabled
  - notification posture can be demonstrated, but real delivery is not yet production-ready

## Current Override Posture

The live club currently overrides four organization areas:

1. Low-risk internal auto-approval
2. Routing rule
3. Approval rule
4. Notification rule

## Launch Risks

1. `team_manager` is the effective default approver and the effective video routing target, but no live `team_manager` membership is currently assigned for `demo-soccer-club`.
2. Email delivery is still `log-only` because the Resend API key is missing.
3. Push delivery is still disabled because no push project is configured.
4. The current identities are still demo identities, not real customer accounts.
