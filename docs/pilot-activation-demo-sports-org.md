# Pilot Activation Record: Demo Sports Organization

Last verified: 2026-06-20

Scope:

- Organization: `demo-sports-org`
- Club: `demo-soccer-club`
- Team: `u14-girls`
- Submitter: `coach@demo-club.local`
- Reviewer: `comms@demo-club.local`

## Configuration Summary

- Organization admin present: `org-admin@demo-club.local`
- Club reviewers present:
  - `club_comms`: `comms@demo-club.local`
  - `club_admin`: `admin@demo-club.local`, `admin@demo-workspace.local`, `comms@demo-club.local`
- Missing role assignment:
  - `team_manager`: no live assignment found

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
- Effective notification posture:
  - email: `false`
  - push: `false`

## Activation Checklist Status

- Confirm the organization slug, club slug, and team slugs: pass
- Confirm every required reviewer account exists and has the expected role: partial
- Confirm the club should inherit organization defaults everywhere except explicitly approved exceptions: pass for documented overrides
- Confirm publishing destinations for internal and public content: pass
- Confirm whether email and push delivery are expected, optional, or intentionally disabled for the pilot: pass, but still non-production

## Evidence Collected

- `/app/readiness` verified live demo identities and publishing destination
- `/organizations/demo-sports-org` verified organization, club, and organization admin
- `/workflow-policies/organizations/demo-sports-org` verified organization defaults
- `/workflow-policies/clubs/demo-soccer-club` verified club overrides and effective policy
- Live VPS database query verified current club and organization memberships

## Launch Rehearsal Evidence

Local operator lane:

- `npm run demo:operator` launched the command center at `http://127.0.0.1:3013/demo`
- `/demo` rendered the operator runbook plus named pilot scenario presets
- `ALLOW_NONEMPTY_QUEUE=1 bash scripts/mobile_demo_review_smoke.sh` passed
- Rehearsal submission id: `d17494aa-3f31-4b99-bce7-0d38fb0d864a`
- Rehearsal approval request id: `67caf6fa-06d4-4aa8-b2d1-e0d7c1c60487`
- Rehearsal published post id: `b60612ea-b7bf-4dac-b384-05d5ca23d5fd`
- Rehearsal published at: `2026-06-20T15:13:54.231Z`

Hosted policy rehearsal:

- `npm run pilot:vps` passed on 2026-06-20
- Baseline review/publish submission: `9a2e7190-5a32-4345-8fc1-d89be13a7a36`
- Organization auto-approval submission: `1079c23e-4ff5-407a-b802-4bae6f32591d`
- Club override manual-review submission: `4fd65bdc-a20a-41f5-8f24-d262c31dc1c2`
- Organization second-approval submission: `2cc2937f-2070-4527-a96e-fa52ae363028`
- Club override direct-publish submission: `a1e36ef2-680b-4d75-9a2a-cb2991a302e5`
- Organization notification submission: `cf181950-7ec4-4e46-a3ab-dd0fe6f4f909`
- Club notification override submission: `35dee5bd-6724-4fe1-aa51-3cc90c0e266d`

Live activation audit:

- `npm run pilot:audit`
- Result: `activation_decision=NO_GO`
- Current blocker output:
  - `Club demo-soccer-club routes to team_manager but no team_manager membership is assigned.`
  - `Demo identities are still assigned: admin@demo-club.local, admin@demo-workspace.local, coach@demo-club.local, comms@demo-club.local, org-admin@demo-club.local.`
  - `Approval queue is not clean. Pending items=5.`
- Current warnings:
  - `Email delivery is not enabled. Current mode=log-only reason=missing_resend_api_key.`
  - `Push delivery is not enabled. Current mode=disabled reason=push_disabled.`

## Go / No-Go Decision

Current status: `NO-GO for real user traffic`

Blocking reasons:

1. No live `team_manager` membership is assigned even though the effective workflow still routes to `team_manager`.
2. Email delivery is still `log-only` because `missing_resend_api_key`.
3. Push delivery is still disabled because `push_disabled`.
4. The current environment still uses demo identities rather than real pilot users.
5. The local rehearsal required `ALLOW_NONEMPTY_QUEUE=1` because the review queue was not clean at start, so queue hygiene is still an operational pre-launch requirement.

## Required Next Changes Before Real Traffic

1. Assign a real `team_manager` user to `demo-soccer-club`, or change the effective routing/default approver path so it no longer depends on `team_manager`.
2. Decide whether real email delivery is required for pilot launch and configure it accordingly.
3. Decide whether push delivery is in scope for the first pilot and configure or explicitly defer it.
4. Replace demo identities with real pilot users and repeat the launch rehearsal.

## Rehearsal Checklist

Run these before the next activation decision:

1. `npm run demo:operator`
2. `bash scripts/mobile_demo_review_smoke.sh`
3. `npm run pilot:vps`

Only change this record to `GO` after those checks pass against real pilot identities and the blockers above are resolved.
