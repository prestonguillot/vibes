# Contributing

## Workflow: branch → PR → CI → merge

`main` is protected on GitHub — you can't push to it directly. Work on a branch and
open a pull request. CI (`.github/workflows/ci.yml`) runs `npm run build` (tsc),
`npm run lint` (ESLint), `npm run format:check` (Prettier), and `npm run test:run` on
every push and PR; that check must be green before a PR can merge. Merges are rebase-only
and the branch is auto-deleted on merge.

## Lint & format

- `npm run lint` — ESLint (type-aware via typescript-eslint). Enforces the conventions
  (no `console.*`, no floating/misused promises, etc.).
- `npm run format` — apply Prettier; `npm run format:check` is what CI runs.
- The `.git-blame-ignore-revs` file lists bulk-reformat commits. To skip them in local
  blame: `git config blame.ignoreRevsFile .git-blame-ignore-revs` (GitHub does this
  automatically).

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

## Vendored frontend libs

The frontend libraries are self-hosted in `public/vendor/` (htmx, Bootstrap CSS, the
htmx SSE extension) rather than loaded from a CDN. They're pinned as devDependencies
(`htmx.org`, `bootstrap`, `htmx-ext-sse`), so Dependabot proposes version bumps like any
other dependency. After bumping one, run `npm run vendor` to copy the new dist files from
`node_modules/` into `public/vendor/`, and commit the result. CI runs `npm run vendor`
and fails if `public/vendor` would change — so a bump can't merge without the vendored
files being refreshed to match.

## Releases

Releases are label-driven (`.github/workflows/release.yml`). When a PR merges into
`main` carrying a `release:patch`, `release:minor`, or `release:major` label, CI tags
the next `vX.Y.Z` and cuts a GitHub Release with auto-generated notes. A PR with no
release label merges without cutting a release. Versioning is tag-based — `package.json`
is not bumped. Pick the bump by impact: patch = fix/chore, minor = feature, major =
breaking change.
