# Pilot Operator Checklist

Use this as the shortest runbook for setting up Club Content in either:

1. the fake simulator environment
2. the real pilot-candidate path

## Fake Simulator Path

Use this when you do not have a real club yet.

### 1. Install the runtime once

Command:

```bash
npm run demo:runtime:install
```

Good result:

- completes without error
- creates the local runtime under `~/.club-content-pilot-runtime`

### 2. Activate the runtime in your shell

Command:

```bash
source ~/.club-content-pilot-runtime/activate.sh
```

Good result:

- no error
- current shell is ready to run the demo scripts

### 3. Prepare the fake tenant

Command:

```bash
npm run pilot:test-tenant
```

Good result:

- fake candidate artifacts are rebuilt
- simulator organization is refreshed when the local stack is available
- command ends without a `NO_GO`

### 4. Start the demo

Command:

```bash
npm run demo:pilot
```

Good result:

- local demo services start
- bundle is written under `tmp/pilot-demo/<timestamp>-<profile>/`
- output includes `pilot_demo_decision=GO`

### 5. Open the main surfaces

Expected URLs:

- `http://127.0.0.1:3013/demo`
- `http://127.0.0.1:3013/quick-review`
- `http://127.0.0.1:3013/workflow-settings?organizationMode=simulator&clubSlug=north-river-soccer-club`

Good result:

- demo page loads
- quick-review loads
- workflow settings show simulator organization defaults and club exceptions

### 6. Run the rehearsal bundle

Command:

```bash
npm run pilot:rehearse
```

Good result:

- bundle is written under `tmp/pilot-rehearsal/<timestamp>-<profile>/`
- output includes `pilot_rehearsal_decision=GO`

### 7. Reset the fake candidate when needed

Command:

```bash
npm run pilot:sandbox
```

Good result:

- fake candidate packet is rebuilt
- fake create and rollback SQL are regenerated
- fake readiness ends `GO`

## Real Pilot-Candidate Path

Use this only when you have real names, emails, and ownership assignments.

### 1. Build the prep kit

Command:

```bash
npm run pilot:prep-real-kit -- /absolute/path/to/validated-simulator-onboarding.md
```

Good result:

- a new bundle is written under `tmp/pilot-real-candidate-kit/<timestamp>/`
- bundle includes:
  - `pilot-onboarding-real-candidate.md`
  - `onboarding-gaps.txt`
  - `pilot-real-data-request.md`
  - `pilot-real-data-request-message.txt`
  - `pilot-real-data-reply-template.txt`
  - `README.md`
- output includes `pilot_real_candidate_kit_status=needs_input` until real values are filled

### 2. Fill the real values

File to fill:

- `tmp/pilot-real-candidate-kit/<timestamp>/pilot-real-data-reply-template.txt`

Good result:

- real org, club, team, reviewer, ownership, notification, and rollback values are present

### 3. Fill the onboarding worksheet

File to update:

- `pilot-onboarding-real-candidate.md` from the latest prep-kit bundle

Good result:

- required identity, owner, reviewer, notification, and rollback fields are filled

### 4. Validate the onboarding worksheet

Command:

```bash
npm run pilot:validate-onboarding -- /absolute/path/to/pilot-onboarding.md
```

Good result:

- output includes `pilot_onboarding_validation=GO`
- output includes `pilot_onboarding_next_step=prepare_from_onboarding`

### 5. Check what is still missing

Command:

```bash
npm run pilot:onboarding-gaps -- /absolute/path/to/pilot-onboarding.md
```

Good result:

- output includes `pilot_real_onboarding_gaps=GO`
- output includes `pilot_real_onboarding_gap_count=0`

### 6. Check launch readiness

Command:

```bash
npm run pilot:check-launch-readiness -- /absolute/path/to/pilot-onboarding.md
```

Good result:

- output includes `pilot_launch_readiness=GO`
- output includes `pilot_launch_readiness_next_step=apply_create_sql`

### 7. Generate the candidate artifacts

Command:

```bash
npm run pilot:prepare-from-onboarding -- /absolute/path/to/pilot-onboarding.md
```

Good result:

- candidate profile is generated
- handoff packet is generated
- creation plan is generated
- readiness passes
- output includes `pilot_prepare_readiness=GO`

### 8. Inspect and validate the candidate profile

Commands:

```bash
npm run pilot:inspect -- <candidate>
PILOT_CANDIDATE_PROFILE=<candidate> bash scripts/validate_pilot_candidate_profile.sh
```

Good result:

- inspect output shows the expected org, club, team, and emails
- validator exits cleanly without template or missing-value errors

### 9. Generate the create and rollback SQL

Command:

```bash
npm run pilot:create-plan -- <candidate>
```

Good result:

- bundle is written under `tmp/pilot-candidate-create-plan...`
- bundle includes:
  - `creation-plan.md`
  - `create.sql`
  - `rollback.sql`

### 10. Confirm readiness

Command:

```bash
npm run pilot:readiness -- <candidate>
```

Good result:

- output includes `pilot_real_candidate_readiness=GO`

### 11. Create the hosted records

Command:

```bash
PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:apply-sql -- <candidate> create
```

Good result:

- hosted create SQL is applied
- SQL-apply bundle is saved
- command ends `GO`

### 12. Run hosted post-create verification

Command:

```bash
PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:post-create-verify
```

Good result:

- hosted audit passes
- hosted VPS scenarios pass
- output includes `pilot_post_creation_decision=GO`

### 13. Roll back immediately if something is wrong

Command:

```bash
PILOT_CANDIDATE_PROFILE=<candidate> npm run pilot:apply-sql -- <candidate> rollback
```

Use this when:

- the wrong people are assigned
- the wrong org, club, or team was created
- hosted audit fails on memberships or routing
- the club should not continue after first verification

## Best Green Signals

The strongest success lines are:

- `pilot_demo_decision=GO`
- `pilot_rehearsal_decision=GO`
- `pilot_onboarding_validation=GO`
- `pilot_real_onboarding_gaps=GO`
- `pilot_launch_readiness=GO`
- `pilot_prepare_readiness=GO`
- `pilot_real_candidate_readiness=GO`
- `pilot_post_creation_decision=GO`
