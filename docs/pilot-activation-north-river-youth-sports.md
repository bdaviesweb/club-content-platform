# Pilot Activation Record: North River Youth Sports

Last verified: 2026-06-20

Scope:

- Organization: `north-river-youth-sports`
- Club: `north-river-soccer-club`
- Team: `u13-girls-blue`
- Submitter: `coach@northriverpilot.local`
- Primary reviewer lane: `manager@northriverpilot.local`
- Secondary reviewer lanes: `comms@northriverpilot.local`, `admin@northriverpilot.local`

## Configuration Summary

- Organization admin present: `ops@northriverpilot.local`
- Club reviewer map:
  - `team_manager`: `manager@northriverpilot.local`
  - `club_comms`: `comms@northriverpilot.local`
  - `club_admin`: `admin@northriverpilot.local`
- Distinct submitter present: `coach@northriverpilot.local`
- Distinct roles confirmed: yes

## Effective Policy Summary

- Default approver role: `team_manager`
- Public approver role: `club_comms`
- Medium-risk approver role: `club_comms`
- Hermes agent routing allowed: `true`
- Effective low-risk internal auto-approval: `false`
- Effective video routing target: `team_manager`
- Effective second approval for public content: `false`
- Effective publishing destinations:
  - internal: `internal_feed`
  - public: `internal_feed`
- Effective notification posture baseline:
  - email: `false`
  - push: `false`

## Activation Checklist Status

- Confirm the organization slug, club slug, and team slugs: pass
- Confirm every required reviewer account exists and has the expected role: pass
- Confirm the club should inherit organization defaults everywhere except explicitly approved exceptions: pass
- Confirm publishing destinations for internal and public content: pass
- Confirm whether email and push delivery are expected, optional, or intentionally disabled for the pilot: pass, but still non-production

## Evidence Collected

- `/app/readiness` verified the simulated pilot candidate payload and publishing destination
- `/organizations/north-river-youth-sports` verified organization, club, team, and organization admin presence
- `/workflow-policies/organizations/north-river-youth-sports` verified organization defaults
- `/workflow-policies/clubs/north-river-soccer-club` verified club overrides and effective policy
- Live VPS database query verified current club and organization memberships

## Launch Rehearsal Evidence

Hosted activation audit:

- `npm run pilot:audit`
- Result: `activation_decision=GO`
- Candidate: `north-river-youth-sports`
- Queue state: `approval_queue_count=0`
- Failed events: `failed_workflow_count=0`
- Current warnings:
  - `Email delivery is not enabled. Current mode=log-only reason=missing_resend_api_key.`
  - `Push delivery is not enabled. Current mode=disabled reason=push_disabled.`

Hosted policy rehearsal:

- `ORGANIZATION_SLUG=north-river-youth-sports CLUB_SLUG=north-river-soccer-club TEAM_SLUG=u13-girls-blue SUBMITTER_EMAIL=coach@northriverpilot.local ORGANIZATION_ADMIN_EMAIL=ops@northriverpilot.local CLUB_ADMIN_EMAIL=admin@northriverpilot.local REVIEWER_EMAIL=comms@northriverpilot.local TEAM_MANAGER_REVIEWER_EMAIL=manager@northriverpilot.local npm run pilot:vps`
- Baseline review/publish submission: `9aa02f3b-1d66-445f-b3bf-d02b7d6e6790`
- Baseline approval request: `85591020-4c27-4a65-aa6e-33571a6c1136`
- Organization auto-approval submission: `691f7c79-0a14-4ddd-adf8-0edc71345be8`
- Club override manual-review submission: `7028d146-16d5-458f-9911-29e6e7d440d4`
- Club override manual-review request: `568ab66e-9644-46bb-af9f-93fa7f2b8806`
- Organization second-approval submission: `7dac604f-71cd-489b-971f-01dca2730280`
- Organization second-approval request: `f22bc72f-fe1b-4fea-996a-1d346c76f0cd`
- Club override direct-publish submission: `3385b8af-6a0e-438a-be25-7364f3d737d7`
- Organization notification submission: `831d9af7-8f41-427c-9a92-17dff0323718`
- Organization notification request: `f3996b27-3310-4547-a254-d07a894a7c29`
- Organization notification log reasons: `notification_policy_email_event_disabled`, `notification_policy_push_event_disabled`
- Club notification override submission: `d4c8360c-f306-486d-a20c-f85a375d7a64`
- Club notification override request: `6d69db9f-76bd-404b-af66-1dd1b953fc90`
- Club notification override reasons: `missing_resend_config`, `push_disabled`

## Go / No-Go Decision

Current status: `GO for simulated pilot rehearsal and operator packaging`

This candidate is suitable for operator onboarding, launch-packet walkthroughs, and policy demonstrations without a real customer account set.

## Remaining Gaps Before Real Customer Traffic

1. Replace simulated identities with real club accounts and repeat the launch audit.
2. Decide whether real email delivery is required for pilot launch and configure it accordingly.
3. Decide whether push delivery is in scope for the first pilot and configure or explicitly defer it.
4. Preserve the reviewer-role mapping discipline in future runbooks so approval actions use the actor that matches the routed role.

## Rehearsal Checklist

Run these before the next activation decision:

1. `npm run demo:operator`
2. `npm run pilot:audit`
3. `ORGANIZATION_SLUG=north-river-youth-sports CLUB_SLUG=north-river-soccer-club TEAM_SLUG=u13-girls-blue SUBMITTER_EMAIL=coach@northriverpilot.local ORGANIZATION_ADMIN_EMAIL=ops@northriverpilot.local CLUB_ADMIN_EMAIL=admin@northriverpilot.local REVIEWER_EMAIL=comms@northriverpilot.local TEAM_MANAGER_REVIEWER_EMAIL=manager@northriverpilot.local npm run pilot:vps`

Only change this record to real-pilot `GO` after those checks pass with real identities and the delivery-provider decisions above are resolved.
