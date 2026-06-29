import { Router } from 'express';
import { Logger } from '../utils/logger';
import { ensureValidSpotifyToken } from '../utils/spotifyAuth';
import { fetchAllPlaylistItems } from '../utils/spotifyPlaylistItems';
import { validate, schemas } from '../utils/validation';
import { z } from 'zod';

const router = Router();

/**
 * GET /api/playlistTracks
 * Fetch Spotify tracks for multiple playlists in parallel (used for client-side
 * search). Query: playlistIds=id1,id2,id3 (comma-separated).
 * Returns: { playlistId: ["Artist • Track", ...], ... }
 *
 * Uses the /items endpoint (via fetchAllPlaylistItems); the old getPlaylistTracks
 * /tracks endpoint was removed by Spotify in Feb 2026.
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
      let accessToken: string;
      try {
        accessToken = await ensureValidSpotifyToken(req, res);
      } catch {
        Logger.error('No valid Spotify token for playlist tracks fetch');
        return res.status(401).json({ error: 'Spotify authentication required' });
      }

      const playlistIds: string[] = req.query.playlistIds;
      const result: Record<string, string[]> = {};

      Logger.info('Fetching tracks for playlists', { count: playlistIds.length });

      const tracksFetched = await Promise.all(
        playlistIds.map(async (playlistId: string) => {
          try {
            const items = await fetchAllPlaylistItems(accessToken, playlistId);
            const tracks = items
              .map(item => item.track)
              .filter((track): track is NonNullable<typeof track> => !!track?.name)
              .map(track => `${track.artists?.[0]?.name || 'Unknown Artist'} • ${track.name}`);
            return { playlistId, tracks };
          } catch (error) {
            Logger.warn('Error fetching tracks for playlist', { playlistId }, error);
            // Return empty array instead of failing the whole request
            return { playlistId, tracks: [] };
          }
        })
      );

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
