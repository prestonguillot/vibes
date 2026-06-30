# Contributing

## Workflow: branch → PR → CI → merge

`main` is protected on GitHub — you can't push to it directly. Work on a branch and
open a pull request. CI (`.github/workflows/ci.yml`) runs `npm run build` (tsc) and
`npm run test:run` on every push and PR; that check must be green before a PR can
merge. Merges are rebase-only and the branch is auto-deleted on merge.

```sh
git switch -c my-change
# ...work, commit...
git push -u origin my-change
gh pr create
```

Branch protection is enforced server-side by GitHub (required PR + required status
check, no force-pushes, no direct pushes — admins included). There is no local git
hook to install.

## Before you start

Copy `.env.example` to `.env` and fill in your own Spotify/YouTube credentials. In
production, also set a `CSRF_SECRET` (`openssl rand -base64 36`); in development the
app generates one if it's unset. Never commit a real `.env` — all `.env*` files
except `.env.example` are gitignored.

## Tests

- `npm run test:run` — the unit + mocked-integration suite. This is what CI runs; no
  test here talks to a real Spotify/YouTube API.
- `npm run test:spotify:live` — opt-in live Spotify connectivity check; needs real
  credentials in `.env`. Excluded from the normal cycle and from CI.
- `npm run test:visual` — Playwright visual-regression + behavior checks. Local-only
  (screenshot baselines are environment-specific); not run in CI.
