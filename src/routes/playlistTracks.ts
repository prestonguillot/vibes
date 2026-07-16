import { Router } from 'express';
import { Logger } from '../lib/logger';
import { ensureValidSpotifyToken } from '../spotify/auth';
import { fetchAllPlaylistItems } from '../spotify/playlistItems';
import { validate, ValidatedRequest } from '../lib/validation';
import { mapWithConcurrency } from '../lib/concurrency';
import { z } from 'zod';

const router = Router();

/**
 * How many playlists to read at once. Each is a paginated fetch, so a library of sixty is a few
 * hundred requests; Spotify rate-limits a burst like that, and the app is not in a hurry - the
 * search box works on names while this loads behind it.
 */
const SPOTIFY_FETCH_CONCURRENCY = 5;

/**
 * GET /api/playlistTracks
 * Fetch Spotify tracks for multiple playlists (used for client-side
 * search). Query: playlistIds=id1,id2,id3 (comma-separated).
 * Returns: { tracks: { playlistId: ["Artist • Track", ...] }, failed: [playlistId] } - a playlist
 * that could not be read is named in `failed`, NOT reported as one with no tracks.
 *
 * Uses the /items endpoint (via fetchAllPlaylistItems); the old getPlaylistTracks
 * /tracks endpoint was removed by Spotify in Feb 2026.
 */
router.get(
  '/api/playlistTracks',
  validate({
    query: z.object({
      playlistIds: z
        .string()
        .transform((val) => val.split(',').filter((id) => id.trim().length > 0))
        .refine((ids) => ids.length > 0, 'At least one playlistId is required')
        .refine((ids) => ids.length <= 100, 'Maximum 100 playlists per request'),
    }),
  }),
  async (req: ValidatedRequest<Record<string, string>, { playlistIds: string[] }>, res) => {
    Logger.requestStart('Get Playlist Tracks Request', {
      playlistCount: req.query.playlistIds?.length || 0,
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
      const tracks: Record<string, string[]> = {};
      const failed: string[] = [];

      Logger.info('Fetching tracks for playlists', { count: playlistIds.length });

      // Bounded, not Promise.all: this is one paginated fetch PER PLAYLIST, and a library of any
      // size fired at once is a burst Spotify answers with 429 - a rate limit brought on by asking
      // for the search index, which then makes the search index wrong.
      const fetched = await mapWithConcurrency(
        playlistIds,
        SPOTIFY_FETCH_CONCURRENCY,
        async (playlistId) => {
          try {
            const items = await fetchAllPlaylistItems(accessToken, playlistId);
            return {
              playlistId,
              tracks: items
                .map((item) => item.track)
                .filter((track): track is NonNullable<typeof track> => !!track?.name)
                .map((track) => `${track.artists?.[0]?.name || 'Unknown Artist'} • ${track.name}`),
            };
          } catch (error) {
            // One playlist failing must not cost the user the other sixty - but it must not be
            // reported as a playlist with no tracks either. An empty list is an answer; this is the
            // absence of one, and only saying so lets the caller tell the user their search is
            // incomplete instead of quietly not matching songs that are right there.
            Logger.warn('Could not fetch tracks for playlist', { playlistId }, error);
            return { playlistId, tracks: null };
          }
        },
      );

      for (const entry of fetched) {
        if (entry.tracks === null) failed.push(entry.playlistId);
        else tracks[entry.playlistId] = entry.tracks;
      }

      if (failed.length > 0) {
        Logger.warn('Some playlists could not be read - the search index is incomplete', {
          failedCount: failed.length,
          requested: playlistIds.length,
        });
      }

      Logger.info('Playlist tracks fetched', {
        playlistsRequested: playlistIds.length,
        playlistsFetched: Object.keys(tracks).length,
        playlistsFailed: failed.length,
      });

      return res.status(200).json({ tracks, failed });
    } catch (error) {
      Logger.error('Error fetching playlist tracks', {}, error);
      return res.status(500).json({ error: 'Failed to fetch playlist tracks' });
    }
  },
);

export default router;
