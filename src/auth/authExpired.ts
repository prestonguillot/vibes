/**
 * The reconnect frame for a session that has run out.
 *
 * ensureValidSpotifyToken / ensureValidYouTubeToken throw SPOTIFY_AUTH_REQUIRED and
 * YOUTUBE_AUTH_REQUIRED to say "this user has to connect again". Only the sync stream ever answered
 * that; every other route let it fall through to a generic handler and rendered "something went
 * wrong, please try again" - which is not something trying again fixes, and never offers the one
 * action that does.
 */

interface AuthExpired {
  service: 'Spotify' | 'YouTube';
  /**
   * Where to reconnect. The partial links it, so rendering without it throws and express turns
   * that into a 500 - an expired session reported as a crash.
   */
  loginUrl: string;
}

/** What the caller must render, or null when this error is not an expired session. */
export function authExpired(error: unknown): AuthExpired | null {
  if (!(error instanceof Error)) return null;

  if (error.message === 'SPOTIFY_AUTH_REQUIRED') {
    return { service: 'Spotify', loginUrl: '/auth/spotify/login' };
  }
  if (error.message === 'YOUTUBE_AUTH_REQUIRED') {
    return { service: 'YouTube', loginUrl: '/auth/youtube/login' };
  }
  return null;
}
