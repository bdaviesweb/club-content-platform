# Multi-Organization Workflow Policy Ship Note

Branch: `codex/multi-org-workflow-policy`

Goal:
Ship the multi-organization workflow policy system by finalizing review artifacts, validating the admin experience end to end, and preparing a safe rollout plan for organization-level defaults, club exceptions, routing rules, and auto-approvals.

## What This Branch Adds

This branch turns workflow policy management into an organization-aware system with club-level exceptions.

Core capability areas:

- Organization defaults for approver roles, routing, auto-approval, second approval, publishing, and notifications
- Club-level overrides with inherited fallback to organization defaults
- Effective policy resolution in the API and worker pipeline
- Admin workflow settings UI for organization and club policy editing
- Simulator and draft preview to compare live and staged workflow outcomes
- Guardrails that warn about risky rollout changes before save
- Rollout visibility that shows which clubs inherit, override, gain, or lose exceptions
- Targeted cleanup tools to remove redundant club exceptions
- Policy history, compare summaries, rollback preview, and restore actions
- VPS smoke coverage for policy-driven approval, routing, publishing, and notification behavior

## Review Artifacts

Primary implementation files:

- `apps/admin-web/server.js`
- `apps/admin-web/server.test.js`
- `apps/app-api/src/workflow-policies.js`
- `apps/app-api/src/workflow-policies.test.js`
- `apps/worker/src/workflow-policy.js`
- `apps/worker/src/pipeline.js`
- `apps/worker/src/workflow-policy.test.js`
- `db/schema.sql`

Smoke and rollout verification scripts:

- `scripts/approval_override_smoke_vps.sh`
- `scripts/auto_approval_override_smoke_vps.sh`
- `scripts/routing_rule_smoke_vps.sh`
- `scripts/publishing_override_smoke_vps.sh`
- `scripts/event_notification_rule_smoke_vps.sh`
- `scripts/qa_vps.sh`

Representative commit milestones:

- `d4d6d2b` Add policy-driven organization workflow controls
- `2522776` Add admin workflow settings management
- `da251d7` Add workflow policy simulator to admin console
- `430fa4b` Warn on risky workflow policy changes
- `82ebb92` Add workflow policy change history
- `5abfc99` Add bulk org exception cleanup
- `2467e08` Add org history restore actions
- `fb5c4ff` Add club history restore actions
- `19db9ae` Persist org rollout snapshots in history
- `c0bd117` Persist club override snapshots in history
- `dfd03d2` Show saved club cleanup opportunities
- `4f05923` Highlight redundant org rollout exceptions
- `e651144` Preserve cleanup context in policy history
- `daa6366` Preview redundant org draft exceptions
- `7185e48` Verify club-only policy history filter

Branch delta versus `origin/main` at the time of this note:

- 40 files changed
- 22,634 insertions
- 224 deletions

## Validation Completed

Fresh verification run on 2026-06-19:

```bash
node --test \
  apps/admin-web/server.test.js \
  apps/admin-web/reviewHandoff.test.js \
  apps/app-api/src/workflow-policies.test.js \
  apps/app-api/src/server.test.js \
  apps/app-api/src/approval-override-smoke-script.test.js \
  apps/app-api/src/auto-approval-override-smoke-script.test.js \
  apps/app-api/src/publishing-override-smoke-script.test.js \
  apps/app-api/src/routing-rule-smoke-script.test.js \
  apps/app-api/src/event-notification-rule-smoke-script.test.js \
  apps/worker/src/workflow-policy.test.js \
  apps/worker/src/pipeline.test.js
```

Result:

- 97 tests passed
- 0 failed

Coverage from that run:

- Admin workflow settings rendering, simulator, draft preview, override filtering, rollout summaries, cleanup previews, history filters, and restore actions
- API policy reads, writes, history, and organization directory behavior
- Policy-driven approval, auto-approval, routing, publishing, and event-notification override smoke coverage
- Worker effective-policy resolution, approver selection, auto-approval decisions, publishing destination selection, and second-approval behavior

Notes from the verification run:

- Notification email and push paths intentionally ran in log-only or disabled mode where provider credentials were absent
- Review-provider fallback behavior was exercised and recorded in tests

Live admin validation on 2026-06-19:

- Loaded the real `workflow-settings` page locally in Safari against a controlled mock API surface that returned organization, club, history, and directory workflow-policy data
- Confirmed the page rendered the organization context, effective policy cards, simulator, rollout posture, history sections, club override summary, organization directory, and both policy editors
- Exercised the organization save path and confirmed it redirected to the saved rollout summary view
- Exercised the club save path and confirmed it redirected to the saved club exception summary view
- Found and fixed a real browser-side regression during this pass: the client save flow referenced `parseSimulationTrace` without defining it in the page script, which broke policy saves after submit
- Added a regression assertion in `apps/admin-web/server.test.js` so the client helper remains present in rendered workflow settings markup

Hosted verification on 2026-06-20:

- Ran `npm run qa:vps` against `hermes-dev`
- Initial hosted run exposed a real deployment regression: `apps/admin-web/Dockerfile` only copied `apps/admin-web`, but the runtime imports now also require `apps/worker/src` and `packages/shared/src`
- Fixed the admin-web image build to copy those runtime dependencies, then reran the hosted verification from the top
- Baseline VPS route smoke passed after the image fix
- Routing rule smoke passed with live evidence that the club override beat the organization default
- Auto-approval rule smoke passed with organization-driven auto-approval
- Auto-approval override smoke passed with a club override disabling organization auto-approval
- Approval publish smoke passed through live review, approval, and worker publish
- Publishing override smoke passed for both organization-default and club-override paths
- Public second approval smoke passed with both approval stages and final publish
- Approval override smoke passed with a club rule disabling organization second approval
- Event notification rule smoke passed for organization event disables and club replacement behavior
- Notification status, readback, and webhook smokes passed
- Final result: `VPS weekly loop verification passed.`

## Admin End-to-End Validation Checklist

Run this pass in the admin UI before opening the release lane:

1. Open `workflow-settings` for one organization with several clubs.
2. Confirm the organization policy editor shows current defaults and affected club counts.
3. Stage an organization change to `routingRule` and confirm the draft preview shows inheriting clubs, override clubs, and projected exception burden.
4. Run the simulator with a concrete case:
   - `contentType=photo`
   - `visibilityTarget=internal`
   - `riskScore=0.19`
   - `moderationFlagged=true`
   - `agentSuggestedApproverRole=club_admin`
5. Confirm the preview clearly shows live versus draft workflow outcome changes.
6. Save an organization-level change and confirm the post-save summary shows:
   - changed areas
   - clubs gaining overrides
   - clubs losing overrides
   - insulated clubs
   - cleanup opportunities
7. Open one club policy stack from the organization summary and confirm inherited versus explicit values are clear.
8. Add a club-specific exception for one area and confirm the simulator uses the club value instead of the organization default.
9. Preview inheriting that club area again and confirm the rollback path is visible before save.
10. Use the club history view and confirm restore actions are available only for club history entries.
11. Use the organization history view and confirm organization rollback previews still preserve the simulator context.
12. Stage bulk cleanup for redundant exceptions and confirm only selected clubs are changed.
13. Save the cleanup and confirm the post-save summary highlights the remaining exceptions and cleanup results.

## Safe Rollout Plan

### Phase 0: Preflight

- Keep rollout on `codex/multi-org-workflow-policy` until PR review is complete
- Use this note as the PR summary backbone
- Run a live browser pass in `apps/admin-web`
- Run hosted dev verification with `npm run qa:vps` before merging
- Verify the dev VPS has the expected workflow-policy schema and environment

### Phase 1: Internal Org Pilot

- Select one organization with a small number of clubs
- Set only organization defaults first
- Do not create club exceptions until the organization baseline behaves correctly
- Use the simulator for at least one internal and one public scenario before each save
- After save, review clubs gaining or keeping exceptions and clear redundant ones
- Validate one real routing case, one real approval case, one real publishing case, and one notification case in dev

### Phase 2: Controlled Expansion

- Add a second organization with a different approval or routing posture
- Introduce club exceptions only where business rules truly differ
- Prefer inheritance over explicit club copies to keep future rollouts manageable
- Review history after each organization-level save to ensure rollback context is preserved
- Use bulk cleanup after large org-default shifts to retire no-op exceptions

### Phase 3: Steady-State Operations

- Treat organization defaults as the normal control surface
- Use club overrides as exceptions, not as parallel policy ownership
- Require simulator review for high-risk changes:
  - public approval changes
  - auto-approval thresholds
  - destination publishing changes
  - notification channel changes
- Review override hotspots regularly and clean up clubs that no longer need explicit values

## Merge Gate

This branch is ready for review packaging now.

Recommended merge gate before shipping:

- PR opened with this summary condensed into the description
- One manual admin browser pass completed
- `npm run qa:vps` completed successfully against `hermes-dev`
- Any provider-specific delivery assumptions called out if email or push remain log-only in dev

## Suggested PR Summary

This branch adds a multi-organization workflow policy system with organization defaults, club exceptions, effective policy resolution in the API and worker, admin policy management UI, simulation and draft preview, rollout guardrails, exception cleanup, and policy history with rollback/restore actions. Verification includes admin-web, API, worker, and policy smoke coverage with 97 passing tests, plus VPS smoke scripts for approval, routing, publishing, and notification overrides.
