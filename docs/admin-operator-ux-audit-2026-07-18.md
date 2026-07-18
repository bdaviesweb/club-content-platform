# Admin Operator UX Audit: 2026-07-18

Scope: North River operator demo flow across demo command center, quick review, and workflow settings.

## Screenshots

Before polish:

- `tmp/ux-audit/2026-07-18-admin-operator/01-demo-command-center.png`
- `tmp/ux-audit/2026-07-18-admin-operator/02-quick-review-empty.png`
- `tmp/ux-audit/2026-07-18-admin-operator/03-workflow-settings.png`

After polish:

- `tmp/ux-audit/2026-07-18-admin-operator-after/01-demo-command-center.png`
- `tmp/ux-audit/2026-07-18-admin-operator-after/02-quick-review-empty.png`
- `tmp/ux-audit/2026-07-18-admin-operator-after/03-workflow-settings.png`

Screenshots were captured with `npx playwright screenshot` because the in-app browser could not reach the host loopback address for this localhost server.

## Step 1: Demo Command Center

Health: improved.

What changed:

- Added a North River pilot rehearsal banner above the command center.
- Made `Pilot gate GO`, operator path, and delivery limitations visible before the long demo sequence.
- Clarified that hosted create SQL is still a deliberate operator action.

Remaining risk:

- The command center is still long. It works for an operator, but a first-time club viewer may still need the shorter demo script beside it.

## Step 2: Quick Review Empty State

Health: improved.

What changed:

- The empty state now explains that an empty queue is the expected clean end state after a demo or smoke run.
- Added a clear next step for generating a demo item.
- Added a direct policy-explanation link so the operator can move from "nothing waiting" into the useful story.

Remaining risk:

- This only improves the empty state. A pending-item state still deserves a separate audit for action clarity and accessibility.

## Step 3: Workflow Settings

Health: improved, still dense.

What changed:

- Added the North River pilot rehearsal banner above the settings page.
- Rewrote the page intro to explain the reading order: pick club, inspect worker behavior, simulate a post, then edit defaults or exceptions.
- Kept the existing policy controls intact.

Remaining risk:

- Workflow settings is still the most cognitively heavy screen. The next pass should separate "explain mode" from "edit mode" or add a guided summary rail for inherited versus overridden areas.

## Accessibility Notes

Visible risks from screenshots:

- Long pages require heavy scanning and may be tiring for keyboard and screen-reader users.
- Links styled as text-only controls can be visually subtle in dense sections.
- The workflow settings page has many repeated fields, so heading structure and focus order should be tested with keyboard navigation.

Not checked from screenshots alone:

- Screen-reader announcements.
- Keyboard-only save, preview, reset, and quick-review action flows.
- Color contrast calculations.
- Mobile viewport behavior after the new banner.

## Highest-Impact Next Fixes

1. Add an explain/edit mode toggle to workflow settings.
2. Add a compact "active exceptions" summary rail for the selected club.
3. Audit the pending quick-review state with an actual queued item.
4. Make delivery posture visible wherever notification controls appear.
5. Add keyboard/focus checks for quick review and workflow settings forms.
