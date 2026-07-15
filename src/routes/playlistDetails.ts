import { Router } from 'express';
import { Logger } from '../lib/logger';
import { sleep } from '../lib/delay';
import { validate, schemas, ValidatedRequest } from '../lib/validation';
import { csrfValidationMiddleware } from '../auth/csrf';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie } from '../auth/cookieParser';
import { CacheDuration, setCache } from '../lib/cache';
import { formatErrorDetails } from '../lib/errorFormatter';
import { escapeHtml } from '../lib/htmlEscape';
import { createYoutubeClient } from '../youtube/client';
import { classifyYoutubeError } from '../youtube/writes';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';
import { fetchPlaylistDetails } from '../sync/playlistDetailsService';
import { addedVideoPosition } from '../sync/addedVideoPosition';
import { searchCandidates } from '../sync/videoPicker';
import { getPlaylist } from '../spotify/client';
import {
  findSyncedYoutubePlaylist,
  findYoutubePlaylistItem,
  syncedPlaylistTitle,
} from '../youtube/playlist';
import { youtubeWrite } from '../youtube/writes';
import type { YoutubeClient } from '../youtube/client';

const router = Router();

/** Moves a video already in the playlist to `position`. One write, 50 quota units. */
async function moveYoutubePlaylistItem(
  youtube: YoutubeClient,
  youtubePlaylistId: string,
  videoId: string,
  position: number,
): Promise<void> {
  const { item } = await findYoutubePlaylistItem(
    youtube,
    youtubePlaylistId,
    (candidate) => candidate.snippet?.resourceId?.videoId === videoId,
    ['snippet'],
  );
  if (!item?.id) throw new Error(`Added video ${videoId} is not in playlist ${youtubePlaylistId}`);

  await youtubeWrite('playlistItems.update', () =>
    youtube.playlistItems.update({
      part: ['snippet'],
      requestBody: {
        id: item.id!,
        snippet: {
          playlistId: youtubePlaylistId,
          position,
          resourceId: { kind: 'youtube#video', videoId },
        },
      },
    }),
  );
}

// Get detailed playlist information (Spotify tracks + YouTube videos)
router.get(
  '/playlist/:playlistId',
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId,
    }),
  }),
  async (req: ValidatedRequest<{ playlistId: string }>, res) => {
    const startTime = Date.now();
    const { playlistId } = req.params;

    Logger.requestStart('Playlist Details Request', {
      playlistId,
    });

    try {
      // Check authentication - Spotify is required, YouTube is optional
      const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(
        req.cookies.spotify_tokens,
        res,
      );
      const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(
        req.cookies.youtube_tokens,
        res,
      );

      if (!spotifyTokens) {
        const html = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/error-message.ejs'),
          {
            type: 'warning',
            title: 'Spotify Authentication Required',
            message: 'Please connect to Spotify first',
            details: 'Use the Spotify connection button at the top of the page to authenticate.',
          },
        );
        return res.status(401).send(html);
      }

      const accessToken = spotifyTokens.accessToken;

      // Initialize YouTube API (optional - only if user is connected)
      const youtube = youtubeTokens ? createYoutubeClient(youtubeTokens.access_token) : null;

      // Resolve the YouTube playlist id. The client may send the id it has cached
      // (X-YT-Playlist-Id); trusting it skips listing all of the user's playlists
      // plus a Spotify name lookup. Without it, resolve by the synced-playlist title.
      let youtubePlaylistId: string | undefined = undefined;
      const cachedYoutubePlaylistId = (
        req.headers['x-yt-playlist-id'] as string | undefined
      )?.trim();
      if (youtube && youtubeTokens) {
        if (cachedYoutubePlaylistId) {
          youtubePlaylistId = cachedYoutubePlaylistId;
        } else {
          const spotifyPlaylist = await getPlaylist(accessToken, playlistId);
          youtubePlaylistId =
            (await findSyncedYoutubePlaylist(youtube, spotifyPlaylist.name))?.id || undefined;
        }
      }

      // Fetch details. A cached id can be stale (the playlist was deleted/recreated):
      // if the fetch fails because the playlist is gone, resolve fresh and retry once.
      let playlistDetails;
      try {
        playlistDetails = await fetchPlaylistDetails(
          accessToken,
          youtube,
          playlistId,
          youtubePlaylistId,
        );
      } catch (error) {
        const notFound = (error as { code?: number }).code === 404;
        if (youtube && youtubeTokens && cachedYoutubePlaylistId && notFound) {
          const spotifyPlaylist = await getPlaylist(accessToken, playlistId);
          youtubePlaylistId =
            (await findSyncedYoutubePlaylist(youtube, spotifyPlaylist.name))?.id || undefined;
          playlistDetails = await fetchPlaylistDetails(
            accessToken,
            youtube,
            playlistId,
            youtubePlaylistId,
          );
        } else {
          throw error;
        }
      }

      // Return the authoritative YouTube playlist id so the client can cache it
      // (empty string clears a now-invalid cached id).
      if (youtube && youtubeTokens) {
        res.set('X-YT-Playlist-Id', youtubePlaylistId || '');
      }

      Logger.info('Playlist details fetched', {
        playlistId,
        totalTracks: playlistDetails.totalTracks,
        linkedCount: playlistDetails.linkedCount,
      });

      // Generate HTML response using shared template
      const viewsPath = path.join(__dirname, '../../views');
      const playlistDetailsHtml = await ejs.renderFile(
        path.join(viewsPath, 'partials/playlist-details.ejs'),
        {
          playlistId: playlistDetails.playlistId,
          playlistName: playlistDetails.playlistName,
          tracks: playlistDetails.tracks,
          linkedCount: playlistDetails.linkedCount,
          totalTracks: playlistDetails.totalTracks,
          hasYoutubeConnection: !!youtubeTokens,
          hasYoutubePlaylist: playlistDetails.hasYoutubePlaylist,
          needsResync: playlistDetails.needsResync,
        },
      );

      const duration = Date.now() - startTime;
      Logger.requestEnd('Playlist Details Request', duration, { playlistId });

      // Always revalidate: the rendered details must reflect the current playlist
      // state on every load (a refresh sends Cache-Control: no-cache to bust it).
      setCache(res, CacheDuration.NO_CACHE);
      return res.send(playlistDetailsHtml);
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('Error fetching playlist details', { playlistId, duration }, error);

      // 'quota' (daily budget gone) and 'rate-limit' (transient throttle) both mean YouTube
      // refused on limits; anything else is a real error.
      const failure = classifyYoutubeError(error);
      if (failure !== 'other') {
        Logger.warn('YouTube refused the read on limits - returning error partial for HTMX', {
          failure,
        });
        // Return error partial for HTMX instead of redirecting
        const html = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/error-message.ejs'),
          {
            type: 'warning',
            title: 'YouTube Quota Exceeded',
            message: 'Your YouTube API quota has been exceeded. YouTube limits API usage per day.',
            details:
              'The quota resets at midnight Pacific Time. You can continue using the app with existing playlists, but cannot load new playlist details until the quota resets.',
          },
        );
        return res.status(403).send(html);
      }

      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/error-message.ejs'),
        {
          type: 'danger',
          title: 'Error loading playlist details',
          message: 'Unable to fetch playlist information. Please try again.',
          details: formatErrorDetails(error),
        },
      );
      return res.status(500).send(html);
    }
  },
);

// Search for alternative YouTube videos for a track
router.get(
  '/search/:trackId',
  validate({
    params: z.object({
      trackId: schemas.alphanumericId,
    }),
    query: z.object({
      trackName: schemas.trackName,
      artistName: schemas.artistName,
      playlistId: schemas.spotifyPlaylistId,
      currentVideoId: schemas.youtubeVideoId.optional().or(z.literal('')),
      searchQuery: schemas.searchQuery.optional(),
    }),
  }),
  async (
    req: ValidatedRequest<
      { trackId: string },
      {
        trackName: string;
        artistName: string;
        playlistId: string;
        currentVideoId?: string;
        searchQuery?: string;
      }
    >,
    res,
  ) => {
    const { trackId } = req.params;
    const { trackName, artistName, playlistId, currentVideoId, searchQuery } = req.query;

    Logger.requestStart('Track Video Search Request', {
      trackId,
      trackName,
      artistName,
      playlistId,
      currentVideoId,
    });

    try {
      const { query, videos: videosWithScores } = await searchCandidates(
        { id: trackId, name: trackName, artist: artistName },
        searchQuery,
      );

      // A manual re-search targets only the results list (HX-Target header), so we send
      // back just that fragment and leave the modal shell (header, search bar, footer)
      // in place. The initial open targets the whole modal and gets the full shell.
      const resultsOnly = req.get('HX-Target') === 'video-results-list';

      if (resultsOnly) {
        const resultsHtml = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/video-results.ejs'),
          { videos: videosWithScores, searchQuery: query },
        );
        res.send(resultsHtml);
        return;
      }

      // Determine if this is for a new link or replacing an existing one
      const isReplacing = currentVideoId && currentVideoId !== '';
      const modalTitle = isReplacing ? 'Select Alternative Video' : 'Select Video';
      // Escape track and artist names to prevent XSS in HTML string construction
      const escapedTrackName = escapeHtml(trackName);
      const escapedArtistName = escapeHtml(artistName);
      const instructionText = isReplacing
        ? `Choose a different YouTube video for: <strong>${escapedTrackName}</strong> by <strong>${escapedArtistName}</strong>`
        : `Choose a YouTube video for: <strong>${escapedTrackName}</strong> by <strong>${escapedArtistName}</strong>`;

      // Render video selection modal from template
      const videoSelectionHtml = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/video-selection-modal.ejs'),
        {
          trackId,
          modalTitle,
          instructionText,
          videos: videosWithScores,
          currentVideoId: currentVideoId || '',
          playlistId,
          trackName,
          artistName,
          searchQuery: query,
        },
      );

      res.send(videoSelectionHtml);
    } catch (error) {
      Logger.error(
        'Error searching for alternative videos',
        { trackId, trackName, artistName },
        error,
      );

      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/error-message.ejs'),
        {
          type: 'danger',
          title: 'Error searching for videos',
          message: 'Unable to search for alternative videos. Please try again.',
          details: formatErrorDetails(error),
        },
      );
      res.status(500).send(html);
    }
  },
);

// Replace a video in a YouTube playlist
router.post(
  '/replace/:trackId',
  csrfValidationMiddleware, // CSRF protection - re-enabled with improved logging
  validate({
    params: z.object({
      trackId: schemas.alphanumericId,
    }),
    body: z.object({
      newVideoId: schemas.youtubeVideoId,
      currentVideoId: schemas.youtubeVideoId.optional().or(z.literal('')),
      playlistId: schemas.spotifyPlaylistId,
    }),
  }),
  async (
    req: ValidatedRequest<
      { trackId: string },
      Record<string, unknown>,
      { newVideoId: string; currentVideoId?: string; playlistId: string }
    >,
    res,
  ) => {
    const { trackId } = req.params;
    const { newVideoId, currentVideoId, playlistId } = req.body;

    Logger.requestStart('Video Replacement Request', {
      trackId,
      currentVideoId,
      newVideoId,
      playlistId,
    });

    try {
      // Check authentication
      const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(
        req.cookies.youtube_tokens,
        res,
      );
      const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(
        req.cookies.spotify_tokens,
        res,
      );

      if (!youtubeTokens) {
        const html = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/error-message.ejs'),
          {
            type: 'warning',
            title: 'YouTube Authentication Required',
            message: 'Please connect to YouTube first',
            details: 'Use the YouTube connection button at the top of the page to authenticate.',
          },
        );
        return res.status(401).send(html);
      }

      if (!spotifyTokens) {
        const html = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/error-message.ejs'),
          {
            type: 'warning',
            title: 'Spotify Authentication Required',
            message: 'Please connect to Spotify first',
            details: 'Use the Spotify connection button at the top of the page to authenticate.',
          },
        );
        return res.status(401).send(html);
      }

      // Initialize YouTube API
      const youtube = createYoutubeClient(youtubeTokens.access_token);

      // Find the YouTube playlist mirroring this Spotify one, by the synced-title convention.
      const spotifyPlaylistData = await getPlaylist(spotifyTokens.accessToken, playlistId);
      const expectedYouTubePlaylistName = syncedPlaylistTitle(spotifyPlaylistData.name);

      Logger.external('YouTube', 'Looking for playlist', { name: expectedYouTubePlaylistName });

      const targetPlaylist = await findSyncedYoutubePlaylist(youtube, spotifyPlaylistData.name);

      if (!targetPlaylist) {
        Logger.error('YouTube playlist not found', { name: expectedYouTubePlaylistName });
        const html = await ejs.renderFile(
          path.join(__dirname, '../../views/partials/error-message.ejs'),
          {
            type: 'danger',
            title: 'Playlist not found',
            message: `Could not find YouTube playlist: "${expectedYouTubePlaylistName}"`,
            details:
              'This playlist may not have been synced yet. Try syncing it from the Spotify playlists page first.',
          },
        );
        return res.status(404).send(html);
      }

      Logger.external('YouTube', 'Found target playlist', {
        title: targetPlaylist.snippet?.title,
        id: targetPlaylist.id,
      });

      // Check if this is adding a new video (unlinked track) or replacing an existing one
      const isAddingNewVideo = !currentVideoId || currentVideoId === '';

      if (isAddingNewVideo) {
        // ADD MODE: Simply add the new video to the end of the playlist
        Logger.info('Adding new video to playlist', {
          newVideoId,
          trackId,
          playlistTitle: targetPlaylist.snippet?.title,
        });

        await youtubeWrite('playlistItems.insert', () =>
          youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: targetPlaylist.id!,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: newVideoId,
                },
              },
            },
          }),
        );

        Logger.info('Added new video successfully', { newVideoId });
      } else {
        // REPLACE MODE: Find and replace the existing video
        Logger.info('Replacing existing video', {
          currentVideoId,
          newVideoId,
          playlistTitle: targetPlaylist.snippet?.title,
        });

        const { item: playlistItemToReplace, itemsScanned: itemsFetched } =
          await findYoutubePlaylistItem(
            youtube,
            targetPlaylist.id!,
            (item) => item.snippet?.resourceId?.videoId === currentVideoId,
            ['snippet', 'contentDetails'],
          );

        if (playlistItemToReplace) {
          Logger.info('Found video to replace', { currentVideoId, itemsFetched });
        }

        if (!playlistItemToReplace) {
          Logger.error('Video not found in playlist after checking all pages', {
            currentVideoId,
            playlistTitle: targetPlaylist.snippet?.title,
            totalItemsChecked: itemsFetched,
          });

          const html = await ejs.renderFile(
            path.join(__dirname, '../../views/partials/error-message.ejs'),
            {
              type: 'danger',
              title: 'Video not found',
              message: `Could not find the video in the YouTube playlist after checking all ${itemsFetched} items.`,
              details:
                'The video may have been removed from the playlist, or the playlist data may be out of sync. Try refreshing the playlist details and trying again.',
            },
          );
          return res.status(404).send(html);
        }

        // Get the position of the current video so we can maintain order
        const currentPosition = playlistItemToReplace.snippet?.position || 0;

        // Add the new video at the same position
        await youtubeWrite('playlistItems.insert', () =>
          youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: targetPlaylist.id!,
                position: currentPosition,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: newVideoId,
                },
              },
            },
          }),
        );

        Logger.info('Added new video', { newVideoId, position: currentPosition });

        // Remove the old video (it will now be at position + 1 due to the insert)
        await youtubeWrite('playlistItems.delete', () =>
          youtube.playlistItems.delete({
            id: playlistItemToReplace.id!,
          }),
        );

        Logger.info('Removed old video', { currentVideoId });
      }

      Logger.info('Video operation completed successfully', {
        operation: isAddingNewVideo ? 'add' : 'replace',
      });

      // A replace is already in order: the insert went in at the old video's position and the old
      // one came out, so the playlist is exactly as the user left it. An addition was appended and
      // has to move to its track's place - one write, at the position worked out below.
      //
      // Neither case reorders the rest of the playlist. Doing that made a one-video edit re-plan
      // all of it and pay 50 quota units per move: 84 moves for a single swap, against a daily
      // budget of 10,000. It also could not finish - YouTube aborted partway with a 409, leaving
      // the order worse than before and the next edit with more to undo. Drift is the sync
      // button's job, where the user asks for it and can see what it costs.
      let placed = true;
      if (isAddingNewVideo) {
        try {
          // YouTube will not move an item it has not finished registering.
          await sleep(3000);

          const position = await addedVideoPosition({
            youtube,
            youtubePlaylistId: targetPlaylist.id!,
            spotifyAccessToken: spotifyTokens.accessToken,
            spotifyPlaylistId: playlistId,
            trackId,
            newVideoId,
          });

          if (position === null) {
            Logger.warn('Leaving the added video at the end: its track is no longer in Spotify', {
              trackId,
              newVideoId,
            });
          } else {
            await moveYoutubePlaylistItem(youtube, targetPlaylist.id!, newVideoId, position);
            Logger.info('Placed the added video at its track’s position', {
              trackId,
              newVideoId,
              position,
            });
          }
        } catch (placementError) {
          placed = false;
          Logger.error(
            'Could not place the added video at its position; it stays at the end',
            { trackId, newVideoId },
            placementError,
          );
        }
      }

      // The write itself landed, so this is not an error - the video is linked and in the playlist.
      // But it is not what was asked for either, and reporting it as such is how a playlist ends up
      // in an order nobody chose with nothing on screen having said so.
      const successMessage = !placed
        ? 'Video linked, but it could not be moved into position - sync the playlist to fix the order.'
        : isAddingNewVideo
          ? 'Video linked successfully!'
          : 'Video replaced successfully!';

      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/video-replace-success.ejs'),
        {
          message: successMessage,
        },
      );

      return res.send(html);
    } catch (error) {
      Logger.error('Error replacing video', { trackId, currentVideoId, newVideoId }, error);

      const html = await ejs.renderFile(
        path.join(__dirname, '../../views/partials/error-message.ejs'),
        {
          type: 'danger',
          title: 'Video replacement failed',
          message: 'Unable to update the playlist. Please try again.',
          details: formatErrorDetails(error),
        },
      );
      return res.status(500).send(html);
    }
  },
);

export { router as playlistDetailsRouter };
