# Visual testing via Argos

Externalized visual regression: baselines live in [Argos](https://argos-ci.com), **not** as
committed PNGs. Argos diffs each PR's screenshots against the branch baseline and posts the
required `argos/default` GitHub check. This replaces checking binary baselines into git and
re-committing them on every intentional change.

- Config: [`playwright.argos.config.ts`](../../playwright.argos.config.ts) (no
  `snapshotPathTemplate` — no local baselines; `desktop` + `mobile` viewport projects)
- Specs: this directory (`components.spec.ts`, `interactive.spec.ts`), capturing with
  `argosScreenshot()`; shared fixtures in `helpers.ts`
- CI: [`.github/workflows/visual.yml`](../../.github/workflows/visual.yml), pinned to the
  Playwright Docker image so rendering is reproducible
- Run locally: `npm run test:visual:argos` (captures + validates; uploads only with a token)

## How review works

- **No change → auto-passes.** A build whose screenshots match the baseline is green with no
  action. Argos only requests a decision when pixels actually move.
- **Changes → accept/reject.** A build with diffs marks `argos/default` failing until you
  approve (accept the new look, which becomes the baseline) or reject in the Argos UI. Because
  it's a required check, an un-reviewed visual change blocks the merge.
- The baseline is established from builds on the reference branch (`main`).

## Coverage

Every spec runs under both viewport projects (`desktop` 1000px, `mobile` 390px):

- **Components** — playlist-details (3 states), progress-update (3), error-message,
  playlist-item (2), video-selection modal, connection-error modal.
- **Interactive** — `:hover` on a video option and a sync button; a full-page component
  showcase (composition).

Behavioural DOM/JS tests (modal open/close, alert dismiss, sync-status SSE) stay in
`tests/visual/` under `playwright.config.ts` — they assert behaviour, not pixels, and need no
baselines.

## Setup (already done; recorded for reference)

1. Argos account at <https://argos-ci.com> via GitHub.
2. Install the Argos GitHub App on the repo (grants the check + accept/reject UI).
3. Add the `ARGOS_TOKEN` repo secret (_Settings → Secrets and variables → Actions_).

## Adding a view

Render it via `renderPartial`/`renderHtml` from `helpers.ts`, then
`await argosScreenshot(page, 'unique-name')`. It captures under every viewport project
automatically. No baseline file to commit.
