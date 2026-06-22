# Pilot Demo Runbook

Use this when you want one repeatable live demo that shows the whole Club Content flow:
submitter, reviewer, backend decisioning, and published output.

## Before You Start

1. Install the local demo runtime once with `npm run demo:runtime:install`.
2. Open a fresh shell and run `source ~/.club-content-pilot-runtime/activate.sh`.
3. For a clean rehearsal, run `npm run demo:runtime:reset`.
4. Preferred path: run `npm run demo:pilot`.
5. If you are staging the surfaces manually, start the operator surface with `npm run demo:operator`.
6. Open `http://127.0.0.1:3013/demo`.
7. If the simulator organization needs a reset and the local database stack is running, run `npm run pilot:simulator-state`.
8. Keep `workflow-settings?organizationMode=simulator` open for the policy explanation steps.

The self-starting path is only considered ready when the bundle shows local API startup, simulator reset, and operator surfaces all succeeded. If the bundle marks the operator step as blocked, fix the local runtime first instead of demoing against a partial setup.

## Operator Commands

1. `npm run demo:runtime:install`
   Installs Postgres.app, Redis, and MinIO into `~/.club-content-pilot-runtime` and writes the activation file.
2. `source ~/.club-content-pilot-runtime/activate.sh`
   Activates the runtime for the current shell so `demo:pilot` can find the local binaries.
3. `npm run demo:runtime:reset`
   Stops demo processes, clears runtime state, and removes old pilot-demo bundles for a cold-start rehearsal.
4. `npm run demo:pilot`
   Runs the full self-starting pilot demo and writes a timestamped evidence bundle under `tmp/pilot-demo/`.
5. `npm run demo:runtime:stop`
   Stops the local demo processes without clearing runtime state.

## Fallback

1. If the runtime install is still pending, use `DRY_RUN=1 npm run demo:pilot` to generate a shareable bundle with the full command plan and story links.
2. If the runtime is installed but you want a clean restart without deleting state, use `npm run demo:runtime:stop` and then rerun `npm run demo:pilot`.

## Demo Sequence

### 1. Happy Path

1. Open the mobile poster flow from the demo command center.
2. Load the demo club.
3. Create a post from the app.
4. Open the reviewer workspace or quick review.
5. Approve the item.
6. Open the internal feed output to show the published result.

### 2. Exception Path: Organization Auto-Approval

1. Open `workflow-settings?organizationMode=simulator`.
2. Show that the organization default can auto-approve low-risk internal photo content.
3. Show the club exception that brings the same content back to manual review.

### 3. Exception Path: Public Video Second Approval

1. Stay on `workflow-settings?organizationMode=simulator`.
2. Show that public video requires a second approval at the organization level.
3. Show the club override that removes the second approval step.

## Closeout

1. Open `/quick-review` to show the fast reviewer surface.
2. Open `/feed/internal?includeSmoke=1` to show the final published output.
3. Use the runbook evidence in `docs/pilot-activation-checklist.md` if you need to capture what was shown.
4. Run `npm run demo:runtime:stop` when you are done, or `npm run demo:runtime:reset` if the next rehearsal needs a cold start.
