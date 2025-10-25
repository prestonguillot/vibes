import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { Logger } from '../utils/logger';
import { parseSpotifyTokenCookie } from '../utils/cookieParser';
import { validate, schemas } from '../utils/validation';
import { z } from 'zod';

const router = Router();

// Create Spotify API instance with current env vars
const getSpotifyApi = () => new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

/**
 * GET /api/playlistTracks
 * Fetch Spotify tracks for multiple playlists in parallel
 * Query params: playlistIds=id1,id2,id3 (comma-separated)
 * Returns: { playlistId: [trackName1, trackName2, ...], ... }
 */
router.get('/api/playlistTracks',
  validate({
    query: z.object({
      playlistIds: z.string()
        .transform(val => val.split(',').filter(id => id.trim().length > 0))
        .refine(ids => ids.length > 0, 'At least one playlistId is required')
        .refine(ids => ids.length <= 100, 'Maximum 100 playlists per request')
    })
  }),
  async (req: any, res) => {
    Logger.requestStart('Get Playlist Tracks Request', {
      playlistCount: req.query.playlistIds?.length || 0
    });

    try {
      const spotifyTokens = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);

      if (!spotifyTokens) {
        Logger.error('No Spotify tokens for playlist tracks fetch');
        return res.status(401).json({ error: 'Spotify authentication required' });
      }

      const spotifyApi = getSpotifyApi();
      spotifyApi.setAccessToken(spotifyTokens.accessToken);
      spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

      const playlistIds: string[] = req.query.playlistIds;
      const result: Record<string, string[]> = {};

      Logger.info('Fetching tracks for playlists', { count: playlistIds.length });

      // Fetch all playlist tracks in parallel
      const tracksFetched = await Promise.all(
        playlistIds.map(async (playlistId: string) => {
          try {
            const tracks: string[] = [];
            let offset = 0;
            let hasMore = true;

            // Pagination: get all tracks (50 per request)
            while (hasMore) {
              const response = await spotifyApi.getPlaylistTracks(playlistId, {
                limit: 50,
                offset
              });

              if (response.body.items) {
                response.body.items.forEach((item: any) => {
                  if (item.track?.name) {
                    // Include artist name with track name, matching the display format
                    const trackName = item.track.name;
                    const artistName = item.track.artists?.[0]?.name || 'Unknown Artist';
                    tracks.push(`${artistName} • ${trackName}`);
                  }
                });
              }

              offset += 50;
              hasMore = response.body.next !== null && response.body.next !== undefined;
            }

            return { playlistId, tracks };
          } catch (error: any) {
            Logger.warn('Error fetching tracks for playlist', { playlistId }, error);
            // Return empty array instead of failing the whole request
            return { playlistId, tracks: [] };
          }
        })
      );

      // Build result object
      tracksFetched.forEach(({ playlistId, tracks }) => {
        result[playlistId] = tracks;
      });

      Logger.info('Playlist tracks fetched successfully', {
        playlistsRequested: playlistIds.length,
        playlistsFetched: Object.keys(result).length
      });

      return res.status(200).json(result);
    } catch (error) {
      Logger.error('Error fetching playlist tracks', {}, error);
      return res.status(500).json({ error: 'Failed to fetch playlist tracks' });
    }
  }
);

export default router;
