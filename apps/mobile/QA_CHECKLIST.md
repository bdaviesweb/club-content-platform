# Mobile QA Checklist

Use this checklist before a TestFlight build or when validating a new mobile workflow change.

For a specific build, create or update a dated QA run file under `apps/mobile/qa-runs/`
so the device results stay tied to the exact TestFlight build.

## Preflight

- Confirm the installed app points at the expected API host in Settings > Build info.
- Record Settings > Build info:
  - Version:
  - Build:
  - API:
  - Role:
  - Bundle:
  - EAS project:
  - Runtime:
- Confirm the public API is healthy:

```sh
curl -fsS https://clubcontent-api.davmn.net/health
```

- Run the mobile QA preflight:

```sh
npm run qa:mobile
```

Expected result: the script runs the hosted public API golden path and confirms review, approval, and publishing still work.

If Metro and the iOS simulator are already running, include the app-driven smoke:

```sh
RUN_SIMULATOR_SMOKE=1 npm run qa:mobile
```

Simulator QA uses the dedicated `Club Content iPhone 17 Pro` simulator by default. Do not run Club Content smokes against `booted`; other apps should use their own named simulators too.

- Run the admin reviewer-console smoke when approval UI behavior changes:

```sh
npm run qa:admin
```

Expected result: the script starts the local admin web console, creates a hosted smoke submission, confirms `/quick-review` renders that item, approves it through the admin UI proxy, and confirms publishing completes.

- Run the public API golden-path smoke when approval, publishing, notifications, or review behavior changed:

```sh
TIMEOUT_SECONDS=300 ./scripts/mobile_qa_public_api_smoke.sh
```

Expected result: the script creates a smoke submission, waits for AI review, approves it, and confirms it reaches `published` with a succeeded publishing job.

If the script waits for review until timeout, check whether the worker is processing events:

```sh
curl -fsS 'https://clubcontent-api.davmn.net/workflow-events?status=pending'
curl -fsS 'https://clubcontent-api.davmn.net/workflow-events?status=failed'
```

`submission.created` events stuck in `pending` usually mean the API is reachable but the worker is not currently consuming the queue. Restart or inspect the VPS worker before continuing mobile QA.

- Run the simulator-driven demo review smoke when checking the installed Expo app flow:

```sh
EXPO_URL='exp://10.0.0.133:8082' TIMEOUT_SECONDS=300 ./scripts/mobile_demo_review_smoke.sh
```

Expected result: the script opens the mobile app, creates a demo post through `demoAction=post`, waits for review, approves it through `demoAction=approveFirstReview`, and confirms the post reaches `published`.

This smoke creates or boots the dedicated `Club Content iPhone 17 Pro` simulator unless `SIMULATOR_DEVICE` is explicitly set. It expects the hosted approval queue to start empty so the app's `approveFirstReview` hook cannot approve an unrelated pending item. If old smoke approvals are present, clean them up before running it.

If you need the deeper VPS/database smoke and SSH is healthy, run:

```sh
TIMEOUT_SECONDS=300 ./scripts/approval_publish_smoke_vps.sh
```

## Submitter Mode

- Open Settings.
- Set Device role to `Submitter`.
- Confirm Build info shows the public API host and expected role.
- Pick a photo or video.
- Enter a short caption with a real score, opponent, or club moment.
- Submit the post.
- Confirm the app shows a successful submission state.
- Open Status.
- Confirm the newest post appears with:
  - status copy that matches the workflow state
  - progress rail
  - media count
  - notification updates when available

## Reviewer Mode

- Open Settings.
- Set Device role to `Reviewer`.
- Confirm reviewer email is set.
- Open Review.
- Confirm pending review items load.
- Open the first queue item.
- Confirm the detail sheet shows:
  - submitted media preview or fallback
  - latest review summary
  - approval controls
- Approve the item.
- Confirm the app checks the publish result.
- Confirm the Review tab shows a `Last approved` card when the item reaches the internal feed.
- Confirm `Share post`, `Open detail`, and `Open feed` actions work from the `Last approved` card.

## Feed And Published Detail

- Open Feed.
- Confirm the approved post appears in the internal feed.
- Confirm image media shows a preview when available.
- Confirm video media uses the video fallback state.
- Open Status.
- Tap a published item.
- Confirm the published detail panel shows:
  - final caption
  - destination
  - published timestamp
  - share action
- Trigger Share post and confirm the native share sheet opens.

## Pass Criteria

- Submitter can create and track a post without changing advanced settings.
- Reviewer can approve a post and see where it published.
- Internal feed shows non-smoke published posts by default.
- Published detail can be shared.
- Settings > Build info is enough to identify the tested build and API.

## Notes

- Smoke-generated posts are hidden from `/feed/internal` by default.
- Use `/feed/internal?includeSmoke=1` only when checking smoke artifacts directly.
- If the approval queue contains old smoke items, run:

```sh
./scripts/cleanup_smoke_approvals_vps.sh
```

Then re-run with `APPLY=1` only when you intend to move smoke approvals out of the active queue.
