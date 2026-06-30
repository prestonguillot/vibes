# Visual testing via Argos (prototype)

Externalized visual regression: baselines live in [Argos](https://argos-ci.com), **not** as
committed PNGs. Argos diffs each PR's screenshots against the branch baseline and posts a
GitHub check with an **accept/reject** UI. This is the alternative to checking binary baselines
into git and re-committing them on every intentional change.

- Config: [`playwright.argos.config.ts`](../../playwright.argos.config.ts) (no
  `snapshotPathTemplate` — no local baselines)
- Specs: this directory, capturing with `argosScreenshot()`
- CI: [`.github/workflows/visual.yml`](../../.github/workflows/visual.yml), pinned to the
  Playwright Docker image so rendering is reproducible
- Run locally: `npm run test:visual:argos` (captures + validates; uploads only with a token)

## One-time setup (requires repo admin)

1. **Create an Argos account** at <https://argos-ci.com> with your GitHub account.
2. **Install the Argos GitHub App** on this repository — this grants the PR status check and
   the accept/reject comparison UI.
3. **Add the project token as a secret:** copy `ARGOS_TOKEN` from the Argos project settings,
   then in GitHub: _Settings → Secrets and variables → Actions → New repository secret_, named
   `ARGOS_TOKEN`.

Until the token exists the `Visual (Argos)` job still runs — it renders and validates the
screenshots and stays green — it just doesn't upload. After the token is added, every PR gets
an Argos comparison to approve or reject.

## Adding a view

Render it the way the local suite does (real partial + `public/css`), then
`await argosScreenshot(page, 'unique-name')`. No baseline file to commit.
