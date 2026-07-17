# Bug backlog

Known issues to work through in the "leftover bugs" phase of the roadmap (after the
meaningful test suite and styling). Newest first. Fix each with a test in the same
commit, per the project conventions in `.claude/CLAUDE.md`.

---

## OAuth first attempt always fails when the flow starts from `localhost`

**Severity:** medium (100% reproducible, self-corrects on retry, looks like a security
error) · **Area:** `src/auth/oauthState.ts`, `src/routes/youtube.ts`,
`src/routes/spotify.ts`

**Symptom:** Clicking "Connect YouTube" (or Spotify) bounces back to
`/?error=youtube&reason=state_mismatch`. Clicking it a second time works, so it reads as
flaky. It is not — the first attempt fails every time.

**Observed 2026-07-16:**

```
GET /AUTH/YOUTUBE/LOGIN  {"fullUrl":"http://localhost:3000/auth/youtube/login"}
YOUTUBE CALLBACK REQUEST START
YouTube callback rejected - OAuth state mismatch {"hasExpectedState":false,"hasReceivedState":true}
```

Login → callback was 7.7 seconds apart, so the 10-minute cookie `maxAge` is not the
cause. `hasExpectedState: false` means the cookie simply was not sent.

**Why it happens:** `localhost` and `127.0.0.1` are different origins for cookies — a
cookie set on one is never sent to the other. `YOUTUBE_REDIRECT_URI` (and the Spotify
one) is registered as `http://127.0.0.1:3000/...`, so:

1. Browsing `localhost:3000`, `/auth/youtube/login` sets `youtube_oauth_state` on **localhost**.
2. Google redirects to the registered **127.0.0.1** callback.
3. The browser sends no cookie for that origin → `hasExpectedState: false` → rejected.
4. The error redirect lands the browser on **127.0.0.1**, so the retry sets and reads the
   cookie on the same origin and succeeds. Hence "it worked the second time".

**Workaround today:** browse `http://127.0.0.1:3000`, never `http://localhost:3000`.

**Likely fix (design choice, not settled):** the flow should not depend on the user
guessing the host. Either redirect `/auth/*/login` to the canonical redirect-URI host
before issuing the state, or derive the redirect URI from the request host so the state
cookie and the callback always share an origin (registering both hosts with the
providers). Also worth reporting `state_mismatch` as "start the connection again" rather
than a security-looking error, since the overwhelmingly likely cause is benign.

---

## A Spotify outage is reported as "you need to re-authenticate"

**Severity:** medium (misleads the user into hunting an account problem) · **Area:**
`src/spotify/auth.ts` (`ensureValidSpotifyToken`)

**Symptom:** While Spotify's auth service was down, the app surfaced
`SPOTIFY_AUTH_REQUIRED`. Nothing was wrong with the token or the account.

**Observed 2026-07-16** (Spotify returned HTTP 503 for ~10 minutes; a direct
`client_credentials` probe reproduced it independently, and the desktop Spotify app failed
at the same time):

```
SpotifyApiError: Spotify token request failed: temporarily_unavailable
Error: SPOTIFY_AUTH_REQUIRED
  [cause]: SpotifyApiError: Spotify token request failed: temporarily_unavailable
```

**Why it happens:** the refresh path treats any token-endpoint failure as an auth
failure. `temporarily_unavailable` is the OAuth2 code (RFC 6749 §5.2) for _the
authorization server is overloaded or down_ — it says nothing about the token.

**Also:** the thrown error carries only the parsed body; the **HTTP status is never
logged**. The 503 had to be recovered with a manual curl. Per the project's own logging
rule, an unexpected external response should log status + url + body snippet.

**Likely fix:** classify `temporarily_unavailable` / `server_error` (and 5xx generally)
as retryable-upstream, not auth-required. Surface "Spotify is having a moment, try
again", leave the stored token alone, and log the status.

---

## Spotify returning `total > 0` with zero items renders as an empty account

**Severity:** medium (looks like data loss) · **Area:** `src/spotify/client.ts`
(`getUserPlaylists`), `src/routes/spotify.ts`, `views/partials/playlist-list-container.ejs`

**Symptom:** Both services said "Connected" and the playlist list was empty — reading as
"you have no playlists" when the account has 63.

**Observed 2026-07-16** (during the Spotify outage above; a 200, not an error):

```
Spotify reports playlists but returned none {"reportedTotal":63}
Fetched Spotify user playlists {"count":0,"reportedTotal":63}
Playlist filtering {"ownOnly":true,"currentUserId":"prestonguillot","totalPlaylists":0}
```

Not our filtering: the "returned null playlist entries" warning fired zero times, and
`totalPlaylists: 0` is logged _before_ the `ownOnly` filter runs. Spotify genuinely
returned `{items: [], total: 63}`.

**Why it happens:** `getUserPlaylists` already detects this exact case and logs a warning
— then returns `[]` anyway, and the route renders the ordinary empty state. The
information exists and is thrown away at the boundary.

**Likely fix:** treat "reported a total, delivered nothing" as a failed fetch rather than
an empty account, and render something that says so. The distinction already has a name
in the code (see the comment above the warning: _"the difference between an empty account
and a broken response"_) — it just needs to reach the user.

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
