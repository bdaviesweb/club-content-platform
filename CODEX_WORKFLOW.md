# Codex Development Workflow

Use this process for focused coding work in this repository.

## Default Loop

1. Start from a clean working tree.
2. Pull the latest `main` before new work when network access is available.
3. Create a focused branch for non-trivial changes.
4. Make the smallest coherent change that solves the current task.
5. Run the most relevant available checks.
6. Review the diff before committing.
7. Commit only when the change works or is a useful, clearly labeled checkpoint.
8. Push and create a PR when the change is ready for review or deployment.

## Critical Function Work

For work that touches app-critical behavior, Codex should run the full developer loop without waiting to be asked each time. App-critical behavior includes uploads, submissions, review routing, approvals, publishing, notifications, auth/session behavior, schema changes, deployment scripts, mobile release identity, and shared contracts.

Default procedure:

1. Confirm the working tree state and avoid mixing unrelated changes.
2. Create or use a focused `codex/<short-purpose>` branch before editing.
3. Define a narrow function or module boundary for the change.
4. Keep the behavior isolated enough to test without a full app run when practical.
5. Add or update focused tests, smoke scripts, or direct verification steps for the changed behavior.
6. Wire the isolated function into the app flow after the behavior is testable.
7. Run the most relevant available checks and record any checks that cannot run.
8. Review the diff before committing.
9. Commit the working change with a clear message.
10. Push and open a PR into `main` when the change is ready for review or deployment, unless the user asks for local-only work.

For provider integrations such as email, push, storage, AI review, or external publishing, keep provider-specific code behind a small internal interface so app flows can be tested with disabled, mocked, or log-only delivery modes.

## Branching

- Use `codex/<short-purpose>` for Codex-created branches.
- Stay on `main` only for inspection, setup, or explicitly requested quick edits.
- Create a branch before changing product code, deployment scripts, schema, or shared contracts.
- Keep branches focused on one task or one closely related set of fixes.

## Commits

- Commit working increments, not half-debugged states.
- Before committing, run `git status` and inspect the diff.
- Use clear imperative commit messages, for example `Add approval queue filters`.
- Do not include secrets, local `.env` files, generated dependency folders, or unrelated cleanup.
- If checks cannot run on this Mac yet, mention that in the commit/PR notes instead of pretending.

## Verification

Prefer the narrowest useful check for the change:

- API changes: `npm --workspace @club/app-api run dev` or endpoint smoke tests.
- Admin web changes: `npm --workspace @club/admin-web run dev` and browser verification.
- Worker changes: `npm --workspace @club/worker run dev` with relevant event flow.
- Mobile changes: `npm --workspace @club/mobile run dev` and simulator/device verification.
- Full stack changes: `docker compose up --build` when Docker is available.

Current placeholder commands:

- `npm run lint`
- `npm test`

These are not fully wired yet, so use targeted manual or smoke verification until the repo has real lint and test targets.

## Pull Requests

- Create PRs from feature branches into `main`.
- Include a short summary, verification performed, and any known setup gaps.
- Prefer draft PRs for work that needs review before it is deployable.
- Push or create PRs only when requested or when the task clearly calls for it.

## New Mac Setup Notes

This Mac needs a few developer tools before the full loop is smooth:

- Git Command Line Tools are installed and working.
- Install a normal Node.js distribution that includes `npm`.
- Install Docker Desktop for full-stack local compose runs.
- Install GitHub CLI (`gh`) for PR creation from the terminal.
- Configure Git author identity with `git config --global user.name` and `git config --global user.email`.
