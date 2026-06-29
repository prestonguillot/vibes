# Contributing

## Workflow: branch → PR → CI → merge

`master` is protected. Don't commit to it directly — work on a branch and open a
pull request. CI (`.github/workflows/ci.yml`) runs `npm run build` (tsc) and
`npm run test:run` on every push and PR; a PR should be green before it merges.

```sh
git switch -c my-change
# ...work, commit...
git push -u origin my-change
gh pr create
```

### Enable the local guard (once per clone)

This repo is private, so GitHub's server-side branch protection isn't available on
the free plan. A tracked git hook enforces the same flow locally — enable it once:

```sh
git config core.hooksPath .githooks
```

After that, `git push` to `master` is rejected with a reminder to use a PR. In a
genuine emergency an admin can bypass with `git push --no-verify`.

> When the repo's git history has been scrubbed of secrets and it's made public,
> this local hook can be replaced by real server-side branch protection. See the
> "scrub .env from history" task.

## Before you start

Copy `.env.example` to `.env` and fill in your own Spotify/YouTube credentials and
a `CSRF_SECRET`. Never commit a real `.env` — all `.env*` files except
`.env.example` are gitignored.

## Tests

- `npm run test:run` — the full suite (runs in CI).
- `npm run test:spotify:live` — opt-in live Spotify connectivity check; needs real
  credentials in `.env` and is excluded from the normal cycle.
