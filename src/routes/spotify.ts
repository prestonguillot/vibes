import { Router, Request } from 'express';
import { createYoutubeClient, YoutubeApiError, YtPlaylist } from '../utils/youtubeClient';
import { Logger } from '../utils/logger';
import { getSecureCookieOptions } from '../utils/authValidation';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { CacheDuration, setCache } from '../utils/cache';
import { youtubeCircuitBreaker } from '../utils/circuitBreaker';
import {
  parseSpotifyTokenCookie,
  parseYouTubeTokenCookie,
  validateAndSerializeSpotifyTokens,
} from '../utils/cookieParser';
import { generateCsrfToken } from '../utils/csrf';
import {
  getAuthorizeUrl,
  exchangeCodeForTokens,
  getCurrentUser,
  getUserPlaylists,
  getPlaylist,
  SpotifyApiError,
} from '../utils/spotifyClient';
import { ensureValidSpotifyToken } from '../utils/spotifyAuth';
import {
  fetchAllYoutubePlaylists,
  findSyncedYoutubePlaylist,
  syncedPlaylistTitle,
} from '../utils/youtubePlaylist';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';

const router = Router();

// Cookie name for the one-time OAuth state value used for CSRF protection.
const SPOTIFY_OAUTH_STATE_COOKIE = 'spotify_oauth_state';

// The OAuth state cookie must use SameSite=Lax (not Strict) so the browser
// includes it on the top-level cross-site redirect back from Spotify's consent
// page. With Strict it would be withheld on that navigation and verification
// would always fail.
const getOAuthStateCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 10 * 60 * 1000, // 10 minutes
  path: '/',
});

// Spotify login
router.get('/login', (req, res) => {
  Logger.requestStart('Spotify Login Request', {
    requestUrl: req.originalUrl,
  });

  const scopes = ['playlist-read-private', 'playlist-read-collaborative'];

  // Generate a random OAuth state. This serves two purposes:
  // 1. CSRF protection - verified against a cookie in the callback.
  // 2. Spotify's authorize endpoint rejects a present-but-empty `state=`
  //    parameter for authenticated users (it renders a generic error page),
  //    so a non-empty value is required for the flow to work at all.
  const state = generateCsrfToken();
  res.cookie(SPOTIFY_OAUTH_STATE_COOKIE, state, getOAuthStateCookieOptions());

  const authorizeURL = getAuthorizeUrl(scopes, state);
  Logger.auth('Spotify', 'redirecting to authorization', { authorizeURL });

  res.redirect(authorizeURL);
});

// Spotify callback
router.get(
  '/callback',
  validate({
    query: z.object({
      code: schemas.oauthCode,
      state: z.string().optional(),
    }),
  }),
  async (req, res) => {
    Logger.requestStart('Spotify Callback Request', {
      requestUrl: req.originalUrl,
      authCodePresent: !!req.query.code,
    });

    const { code, state } = req.query;

    // Verify the OAuth state against the one-time cookie set during /login to
    // prevent CSRF. The cookie is single-use, so clear it regardless of outcome.
    const expectedState = req.cookies[SPOTIFY_OAUTH_STATE_COOKIE];
    res.clearCookie(SPOTIFY_OAUTH_STATE_COOKIE, { path: '/' });
    if (!expectedState || !state || state !== expectedState) {
      Logger.warn('Spotify callback rejected - OAuth state mismatch', {
        hasExpectedState: !!expectedState,
        hasReceivedState: !!state,
      });
      return res.redirect('/?error=spotify&reason=state_mismatch');
    }

    try {
      const tokens = await exchangeCodeForTokens(code as string);

      // Validate tokens before storing in cookie
      const serializedTokens = validateAndSerializeSpotifyTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });

      res.cookie('spotify_tokens', serializedTokens, getSecureCookieOptions());

      Logger.auth('Spotify', 'tokens stored in cookie');

      // Redirect back to main page - status endpoint will detect connection
      res.redirect('/');
    } catch (error) {
      Logger.error('Error getting Spotify tokens', {}, error);
      // Redirect back to home with error indicator in query params
      let errorReason = 'failed';
      if (error instanceof SpotifyApiError) {
        if (error.status === 429) {
          errorReason = 'rate_limited';
        } else if (error.status === 401) {
          errorReason = 'auth_error';
        } else if (error.status === 503 || error.status === 502) {
          errorReason = 'service_unavailable';
        }
      }
      res.redirect(`/?error=spotify&reason=${errorReason}`);
    }
  },
);

// Get user's playlists with improved layout - testing hot reload
router.get(
  '/playlists',
  validate({
    query: z.object({
      ownOnly: schemas.booleanFlag.optional(),
    }),
  }),
  async (req: ValidatedRequest<Record<string, string>, { ownOnly?: boolean }>, res) => {
    Logger.requestStart('Spotify Playlists Request', {
      requestUrl: req.originalUrl,
      queryParams: req.query,
    });

    const spotifyTokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
    if (!spotifyTokens) {
      return res.status(401).render('partials/error-message', {
        message: 'Please connect to Spotify first',
        type: 'warning',
      });
    }

    try {
      const accessToken = await ensureValidSpotifyToken(req as Request, res);

      // Get current user info for ownership filtering
      const user = await getCurrentUser(accessToken);
      const currentUserId = user.id;

      // Set up the YouTube client to check for existing playlists (when connected)
      let youtubeTokens = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);
      const youtube = youtubeTokens ? createYoutubeClient(youtubeTokens.access_token) : null;

      // Get Spotify playlists (paginated, null-filtered and typed by the client)
      let spotifyPlaylists = await getUserPlaylists(accessToken);

      // Filter for own playlists only if requested
      // Note: Zod transforms the string 'true'/'false' to boolean true/false
      const ownOnly = req.query.ownOnly === true;
      Logger.debug('Playlist filtering', {
        ownOnly,
        currentUserId,
        totalPlaylists: spotifyPlaylists.length,
        rawQueryParam: req.query.ownOnly,
      });

      if (ownOnly) {
        const beforeFilter = spotifyPlaylists.length;
        spotifyPlaylists = spotifyPlaylists.filter(
          (playlist) => playlist.ownerId === currentUserId,
        );
        Logger.debug('Applied ownOnly filter', {
          before: beforeFilter,
          after: spotifyPlaylists.length,
          currentUserId,
        });
      }

      // Get ALL YouTube playlists to check which Spotify playlists have been synced (with pagination)
      const youtubePlaylistNames = new Set<string>();
      const youtubePlaylistsMap = new Map<string, YtPlaylist>();

      if (youtubeTokens) {
        // Check circuit breaker before making API calls
        if (!youtubeCircuitBreaker.canProceed()) {
          Logger.warn('YouTube API circuit breaker is OPEN, clearing YouTube tokens', {
            state: youtubeCircuitBreaker.getState(),
          });
          // Clear YouTube tokens so user sees disconnected state
          res.clearCookie('youtube_tokens');
          youtubeTokens = null;
        } else {
          try {
            const allYoutubePlaylists = await fetchAllYoutubePlaylists(youtube!);
            allYoutubePlaylists.forEach((playlist) => {
              const title = playlist.snippet?.title || '';
              youtubePlaylistNames.add(title);
              youtubePlaylistsMap.set(title, playlist);
            });

            // Success - record it
            youtubeCircuitBreaker.recordSuccess();
          } catch (error: unknown) {
            const errorCode = error instanceof YoutubeApiError ? error.code : undefined;
            if (errorCode === 403) {
              Logger.warn('YouTube API quota exceeded when fetching playlists, clearing tokens', {
                errorCode,
              });
              // Open circuit breaker for quota errors
              youtubeCircuitBreaker.open();
              // Clear YouTube tokens
              res.clearCookie('youtube_tokens');
              // This list is loaded via htmx, so a 302 would be swapped into the
              // container. Use HX-Redirect to trigger a real navigation to the home
              // page (which shows the quota modal), matching the OAuth-failure UX.
              res.set('HX-Redirect', '/?error=youtube&reason=quota_exceeded');
              return res.status(403).send('');
            } else {
              Logger.warn('Could not fetch YouTube playlists for sorting', {}, error);
              // Record failure but don't necessarily open circuit (might be transient)
              youtubeCircuitBreaker.recordFailure(error);
              // Continue without YouTube playlist info
            }
          }
        }
      }

      // Categorize and sort playlists
      // Check if a Spotify playlist has been synced by looking for a YouTube playlist with " (from Spotify)" suffix
      const syncedPlaylists = spotifyPlaylists
        .filter((playlist) => youtubePlaylistNames.has(syncedPlaylistTitle(playlist.name)))
        .sort((a, b) => a.name.localeCompare(b.name));

      const unsyncedPlaylists = spotifyPlaylists
        .filter((playlist) => !youtubePlaylistNames.has(syncedPlaylistTitle(playlist.name)))
        .sort((a, b) => a.name.localeCompare(b.name));

      // Combine with synced playlists first
      const sortedPlaylists = [...syncedPlaylists, ...unsyncedPlaylists];

      const viewsPath = path.join(__dirname, '../../views');

      const playlistsHtml = await Promise.all(
        sortedPlaylists.map(async (playlist) => {
          const isSynced = youtubePlaylistNames.has(syncedPlaylistTitle(playlist.name));
          const syncIcon = isSynced ? '' : '';
          const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
          const buttonClass = isSynced ? 'btn-outline-success' : 'btn-primary';

          // Get YouTube playlist info if it exists
          const youtubePlaylist = youtubePlaylistsMap.get(syncedPlaylistTitle(playlist.name));
          const youtubePlaylistUrl = youtubePlaylist
            ? `https://www.youtube.com/playlist?list=${youtubePlaylist.id}`
            : undefined;
          const youtubeTracksTotal = youtubePlaylist?.contentDetails?.itemCount || 0;

          // Spotify's dev-mode /me/playlists may omit the per-playlist count; the
          // client maps that to null and the template omits it. The real count shows
          // in the details view, which fetches the items.
          return await ejs.renderFile(path.join(viewsPath, 'partials/playlist-item.ejs'), {
            id: playlist.id,
            name: playlist.name,
            tracksTotal: playlist.trackTotal,
            youtubeTracksTotal,
            spotifyUrl: playlist.spotifyUrl,
            youtubeUrl: youtubePlaylistUrl,
            isSynced,
            syncIcon,
            buttonText,
            buttonClass,
            isYouTubeConnected: !!youtubeTokens,
            isDisabled: false,
          });
        }),
      ).then((items) => items.join(''));

      // Create summary text - different messages based on YouTube connection and sync status
      let summaryText: string;
      if (!youtubeTokens) {
        // YouTube not connected - can't determine sync status
        summaryText = `Showing ${spotifyPlaylists.length} playlists`;
      } else if (syncedPlaylists.length > 0) {
        // YouTube connected and some playlists are synced
        summaryText = `Showing ${syncedPlaylists.length} synced and ${unsyncedPlaylists.length} unsynced playlists`;
      } else {
        // YouTube connected but no playlists synced yet
        summaryText = `Showing ${unsyncedPlaylists.length} playlists (none synced yet)`;
      }

      // Cache for 30 minutes (LONG): this response lists ALL YouTube playlists to
      // determine sync status, so caching it protects the scarce YouTube quota.
      // The refresh button sends Cache-Control: no-cache to get fresh data on demand.
      setCache(res, CacheDuration.LONG);
      Logger.info('Setting cache header for playlists response', {
        cacheDuration: CacheDuration.LONG,
      });
      res.render('partials/playlist-list-container', { summaryText, playlistsHtml });
    } catch (error) {
      Logger.error('Error fetching playlists', {}, error);

      // Check if it's an authentication error
      if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
        return res.status(401).render('partials/auth-expired', { service: 'Spotify' });
      }

      // Check if it's a Spotify API server error (502/503)
      const statusCode = error instanceof SpotifyApiError ? error.status : undefined;
      if (statusCode === 502 || statusCode === 503) {
        Logger.warn('Spotify API temporary error', { statusCode });
        return res.status(503).render('partials/error-message', {
          message: 'Spotify is temporarily unavailable',
          type: 'warning',
          details: "Spotify's servers are experiencing issues. Please try again in a few moments.",
        });
      }

      // Check for rate limiting (429)
      if (statusCode === 429) {
        Logger.warn('Spotify API rate limit exceeded', { statusCode });
        return res.status(429).render('partials/error-message', {
          message: 'Too many requests to Spotify',
          type: 'warning',
          details: 'Please wait a moment before trying again.',
        });
      }

      res
        .status(500)
        .render('partials/error-message', { message: 'Error fetching playlists', type: 'danger' });
    }
  },
);

// Get sync button for a playlist (for refresh after sync)
router.get(
  '/playlist-button/:playlistId',
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId,
    }),
  }),
  async (req: ValidatedRequest<{ playlistId: string }>, res) => {
    Logger.requestStart('Spotify Playlist Button Request', {
      playlistId: req.params.playlistId,
    });

    const spotifyTokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
    const youtubeTokens = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);

    if (!spotifyTokens) {
      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'),
        {
          message: 'Connect to Spotify First',
        },
      );
      return res.status(401).send(html);
    }

    if (!youtubeTokens) {
      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'),
        {
          message: 'Connect to YouTube to Sync',
          title: 'Connect to YouTube first',
        },
      );
      return res.send(html);
    }

    try {
      const accessToken = await ensureValidSpotifyToken(req as Request, res);
      const { playlistId } = req.params;

      // Get this specific playlist
      const playlist = await getPlaylist(accessToken, playlistId);

      // Set up the YouTube client to check if this playlist has been synced
      const youtube = createYoutubeClient(youtubeTokens.access_token);

      // Check if a YouTube playlist exists for this Spotify playlist
      let isSynced = false;

      try {
        const foundPlaylist = await findSyncedYoutubePlaylist(youtube, playlist.name);
        if (foundPlaylist) {
          isSynced = true;
        }
      } catch (error) {
        Logger.warn('Error checking YouTube playlist status', {}, error);
        // Continue without YouTube status
      }

      const buttonText = isSynced ? 'Update YouTube Playlist' : 'Sync to YouTube';
      const buttonClass = isSynced ? 'btn-outline-success' : 'btn-primary';

      // Render button from template
      const buttonHtml = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/sync-button.ejs'),
        {
          buttonClass,
          playlistId,
          playlistName: playlist.name,
          trackCount: playlist.trackTotal ?? 0,
          buttonText,
        },
      );

      return res.send(buttonHtml);
    } catch (error) {
      Logger.error('Error fetching playlist button', {}, error);

      if (error instanceof Error && error.message === 'SPOTIFY_AUTH_REQUIRED') {
        const html = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'),
          {
            message: 'Reconnect to Spotify',
          },
        );
        return res.status(401).send(html);
      }

      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/sync-button-disabled.ejs'),
        {
          message: 'Error',
        },
      );
      return res.status(500).send(html);
    }
  },
);

export { router as spotifyRouter };
