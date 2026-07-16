# Bug backlog

Known issues to work through in the "leftover bugs" phase of the roadmap (after the
meaningful test suite and styling). Newest first. Fix each with a test in the same
commit, per the project conventions in `.claude/CLAUDE.md`.

---

## Connection button does not reflect an expired OAuth session until reload

**Severity:** low (self-corrects on refresh) · **Area:** `views/index.ejs`,
`src/routes/spotify.ts` (`/api/status/spotify/button`), YouTube equivalent

**Symptom:** When a session reaches a state where the only recovery is to
re-authenticate through OAuth, the connection button keeps saying "Connected". The
inline panels already do the right thing (a 401 that cannot be refreshed now renders a
"Reconnect" prompt — see PR #160), but the top-of-page button is stale.

**Desired behavior (from Preston):** If I wind up in a situation where the only recovery
is to re-authenticate through OAuth, the UI should reflect that and indicate to me what
to do — i.e. the connection button should flip to "Connect Spotify" / "Connect YouTube"
without requiring a manual page reload.

**Why it happens:** `/api/status/spotify/button` _does_ validate the token (a live `/me`
probe) and clears the cookie when it can't be refreshed — but `index.ejs` loads that
button once on `hx-trigger="load"` with no polling, so it reflects validity at page load
only, then self-corrects on the next reload.

**Likely fix (design choice, not settled):** When a details/replace/sync request returns
the reconnect prompt, have it also drive an HTMX out-of-band swap (or a custom
`HX-Trigger` the button listens for) so the button re-fetches its status and flips
immediately. Do the same for YouTube. Keep it stateless — the button re-probes; the
server holds no session state.
