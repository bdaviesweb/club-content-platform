# Pilot Sandbox Environment

Use this when you want a repeatable non-customer test environment that exercises:

1. simulator organization policy behavior
2. fake pilot-candidate preparation
3. create/rollback SQL generation
4. readiness gating
5. local demo/operator flow

This stays safely away from live club data.

## Fake Candidate Prep

The committed sandbox intake lives at [pilot-sandbox-intake.txt](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-sandbox-intake.txt).

Run this to rebuild the fake candidate artifacts from scratch:

1. `npm run pilot:sandbox`

That command recreates:

1. `config/pilot-candidates/sandbox-summit-pilot.local.env`
2. `tmp/sandbox-pilot-candidate-handoff.md`
3. `tmp/pilot-candidate-create-plan-sandbox/.../creation-plan.md`
4. `tmp/pilot-candidate-create-plan-sandbox/.../create.sql`
5. `tmp/pilot-candidate-create-plan-sandbox/.../rollback.sql`
6. a `pilot_real_candidate_readiness=GO` result for the fake candidate

## Local Demo Runtime

Install once:

1. `npm run demo:runtime:install`

Activate in each new shell:

1. `source ~/.club-content-pilot-runtime/activate.sh`

Clean restart when needed:

1. `npm run demo:runtime:reset`

## Full Sandbox Demo

Run the full local simulator demo:

1. `OPEN_SURFACES=0 npm run demo:pilot`

If that reaches `pilot_demo_decision=GO`, the bundle will include:

1. local API startup
2. local worker startup
3. simulator state reset
4. operator surfaces
5. captured workflow and feed artifacts

The latest successful bundle is written under `tmp/pilot-demo/`.

## Main URLs

When the local demo stays up, the main surfaces are:

1. `http://127.0.0.1:3013/demo`
2. `http://127.0.0.1:3013/quick-review`
3. `http://127.0.0.1:3013/workflow-settings?organizationMode=simulator&clubSlug=north-river-soccer-club`

## Boundary

This sandbox is only for:

1. demoing multi-organization policy behavior
2. proving the intake-to-artifacts flow
3. rehearsing review and publish behavior locally

Do not treat the sandbox candidate as a real launch candidate.
Use [pilot-real-candidate-intake.md](/Users/robertdavies/Documents/Codex/club-content/docs/pilot-real-candidate-intake.md) for the real pilot-club path.
