# Quick Review Keyboard QA

Date: 2026-07-18

The review dock exposes `A approve`, `C changes`, and `R reject` and the page-level key handler ignores text inputs and textareas, preventing shortcuts from corrupting reviewer notes. The action controls are native buttons, so normal Tab and Enter activation are available.

Finding: after an `A`, `C`, or `R` shortcut changes the selected decision, focus remains on the previously focused element. This is usable, but a reviewer navigating repeatedly by keyboard would benefit from moving focus to the primary action button or announcing the new decision through an `aria-live` status region. This is a polish item, not a release blocker.

Evidence limit: the saved mobile media capture is at `tmp/ux-audit/2026-07-18-media-quick-review/01-mobile-media-pending.png`. Browser automation could not load the repository's Playwright module directly in this shell, so keyboard behavior was verified from the rendered markup and handler source rather than a fresh focus screenshot.
