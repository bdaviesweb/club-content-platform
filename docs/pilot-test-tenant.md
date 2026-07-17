# Pilot Test Tenant

Use this path when you want to prove the product before you have a real club or team.

The test tenant combines two safe ingredients:

1. the committed simulator organization for workflow policy behavior
2. the sandbox candidate packet for fake onboarding, SQL plans, and readiness artifacts

## One Command Setup

Run:

1. `npm run pilot:test-tenant`

That setup command:

1. rebuilds the fake candidate profile and handoff artifacts
2. regenerates create and rollback SQL for the fake candidate
3. refreshes the simulator organization when the local database stack is available

## What You Can Prove

With the test tenant, you can prove:

1. organization defaults
2. club-level exceptions
3. routing rules
4. auto-approvals
5. second approvals
6. reviewer and operator flow
7. demo packaging and rehearsal steps

## Main Surfaces

1. `http://127.0.0.1:3013/demo`
2. `http://127.0.0.1:3013/quick-review`
3. `http://127.0.0.1:3013/workflow-settings?organizationMode=simulator&clubSlug=north-river-soccer-club`

## Recommended Flow

1. `npm run pilot:test-tenant`
2. `npm run demo:pilot`
3. `npm run pilot:rehearse`
4. Walk the workflow settings page to explain org defaults and club overrides.
5. Walk the demo and quick-review pages to explain poster, reviewer, backend, and published-output flow.

## Boundary

This is not a live customer environment.

Use [pilot-real-candidate-intake.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-real-candidate-intake.md) only when you are ready to swap from the test tenant to a real organization.
