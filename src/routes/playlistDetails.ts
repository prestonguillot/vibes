import { Router } from 'express';
import { google } from 'googleapis';
import { scrapeYouTubeSearch, parseViewCount } from '../utils/youtubeScraper';
import { Logger } from '../utils/logger';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { csrfValidationMiddleware } from '../utils/csrf';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { parseSpotifyTokenCookie, parseYouTubeTokenCookie } from '../utils/cookieParser';
import { CacheDuration, setCache } from '../utils/cache';
import { formatErrorDetails } from '../utils/errorFormatter';
import { escapeHtml } from '../utils/htmlEscape';
import { youtube_v3 } from 'googleapis';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { reorderPlaylistTracks } from '../utils/playlistReordering';
import { fetchPlaylistDetails } from '../services/playlistDetailsService';
import { calculateMatchScore, SimplifiedTrack, SimplifiedVideo } from '../utils/trackMatching';
const router = Router();

// Helper function to get Spotify API instance
function getSpotifyApi() {
  return new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });
}

// Helper function to get YouTube OAuth2 client
function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

// Get detailed playlist information (Spotify tracks + YouTube videos)
router.get('/playlist/:playlistId',
  validate({
    params: z.object({
      playlistId: schemas.spotifyPlaylistId
    })
  }),
  async (req: ValidatedRequest<{ playlistId: string }>, res) => {
  const startTime = Date.now();
  const { playlistId } = req.params;
  
  Logger.requestStart('Playlist Details Request', {
    playlistId
  });

  try {
    // Check authentication - Spotify is required, YouTube is optional
    const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);
    const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);

    if (!spotifyTokens) {
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'Spotify Authentication Required',
        message: 'Please connect to Spotify first',
        details: 'Use the Spotify connection button at the top of the page to authenticate.'
      });
      return res.status(401).send(html);
    }

    // Initialize Spotify API
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

    // Initialize YouTube API (optional - only if user is connected)
    const youtube = youtubeTokens ? (() => {
      const oauth2Client = getOAuth2Client();
      oauth2Client.setCredentials(youtubeTokens);
      return google.youtube({ version: 'v3', auth: oauth2Client });
    })() : null;

    // Find YouTube playlist ID if YouTube is connected (for use with the shared service)
    let youtubePlaylistId: string | undefined = undefined;
    if (youtube && youtubeTokens) {
      const spotifyPlaylist = await spotifyApi.getPlaylist(playlistId);
      const youtubePlaylistTitle = `${spotifyPlaylist.body.name} (from Spotify)`;
      Logger.external('YouTube', 'Looking for playlist', { title: youtubePlaylistTitle });

      let nextPageToken: string | undefined = undefined;
      let youtubePlaylist: youtube_v3.Schema$Playlist | undefined = undefined;

      do {
        const youtubePlaylistsResponse: youtube_v3.Schema$PlaylistListResponse = await youtube.playlists
          .list({
            part: ['snippet'],
            mine: true,
            maxResults: 50,
            pageToken: nextPageToken
          })
          .then(res => res.data);

        youtubePlaylist = youtubePlaylistsResponse.items?.find(
          (playlist: youtube_v3.Schema$Playlist) => playlist.snippet?.title === youtubePlaylistTitle
        );

        if (youtubePlaylist) break;
        nextPageToken = youtubePlaylistsResponse.nextPageToken || undefined;
      } while (nextPageToken);

      if (youtubePlaylist) {
        youtubePlaylistId = youtubePlaylist.id;
        Logger.external('YouTube', 'Found matching playlist', { playlistId: youtubePlaylistId });
      } else {
        Logger.info('No corresponding YouTube playlist found');
      }
    } else {
      Logger.info('YouTube not connected, skipping YouTube playlist lookup');
    }

    // Fetch all playlist details using shared service (eliminates code duplication)
    const playlistDetails = await fetchPlaylistDetails(spotifyApi, youtube, playlistId, youtubePlaylistId);

    Logger.info('Playlist details fetched', {
      playlistId,
      totalTracks: playlistDetails.totalTracks,
      linkedCount: playlistDetails.linkedCount
    });

    // Generate HTML response using shared template
    const viewsPath = path.join(__dirname, '../../views');
    const playlistDetailsHtml = await ejs.renderFile(path.join(viewsPath, 'partials/playlist-details.ejs'), {
      playlistId: playlistDetails.playlistId,
      playlistName: playlistDetails.playlistName,
      tracks: playlistDetails.tracks,
      linkedCount: playlistDetails.linkedCount,
      totalTracks: playlistDetails.totalTracks,
      hasYoutubeConnection: !!youtubeTokens,
      hasYoutubePlaylist: playlistDetails.hasYoutubePlaylist
    });

    const duration = Date.now() - startTime;
    Logger.requestEnd('Playlist Details Request', duration, { playlistId });

    // Cache for 10 minutes (MEDIUM) - balances freshness with API quota
    // Users may frequently modify playlist contents, so keep cache relatively short
    setCache(res, CacheDuration.MEDIUM);
    res.send(playlistDetailsHtml);

  } catch (error) {
    const duration = Date.now() - startTime;
    Logger.error('Error fetching playlist details', { playlistId, duration }, error);

    // Check if it's a YouTube API quota exceeded error
    const errorCode = (error as any)?.code;
    const errorMessage = (error as Error)?.message || '';
    const gaxiosError = error as { errors?: Array<{ reason?: string }> };

    if (errorCode === 403 || (gaxiosError.errors && gaxiosError.errors.some((e) => e.reason === 'quotaExceeded'))) {
      Logger.warn('YouTube API quota exceeded - redirecting with error modal');
      // Redirect to home with error modal - consistent with other quota error handling
      return res.redirect('/?error=youtube&reason=quota_exceeded');
    }

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'danger',
      title: 'Error loading playlist details',
      message: 'Unable to fetch playlist information. Please try again.',
      details: formatErrorDetails(error)
    });
    res.status(500).send(html);
  }
});

// Search for alternative YouTube videos for a track
router.get('/search/:trackId',
  validate({
    params: z.object({
      trackId: schemas.alphanumericId
    }),
    query: z.object({
      trackName: schemas.trackName,
      artistName: schemas.artistName,
      playlistId: schemas.spotifyPlaylistId,
      currentVideoId: schemas.youtubeVideoId.optional().or(z.literal(''))
    })
  }),
  async (req: ValidatedRequest<
    { trackId: string },
    { trackName: string; artistName: string; playlistId: string; currentVideoId?: string }
  >, res) => {
  const { trackId } = req.params;
  const { trackName, artistName, playlistId, currentVideoId } = req.query;

  Logger.requestStart('Track Video Search Request', {
    trackId,
    trackName,
    artistName,
    playlistId,
    currentVideoId
  });

  try {
    // Search for videos using the YouTube scraper
    const searchQuery = `${trackName} ${artistName}`;
    Logger.external('YouTube', 'Searching for videos', { query: searchQuery });

    const searchResults = await scrapeYouTubeSearch(searchQuery, 10);

    const videos = searchResults.map((result) => ({
      id: result.videoId,
      title: result.title,
      description: `Duration: ${result.duration} • Views: ${result.views}`,
      thumbnail: `https://img.youtube.com/vi/${result.videoId}/mqdefault.jpg`,
      channelTitle: result.channel,
      publishedAt: '', // Not available from scraper
      url: `https://www.youtube.com/watch?v=${result.videoId}`
    }));

    Logger.info('Found alternative videos', { count: videos.length });

    // Calculate match scores for each video
    const spotifyTrack: SimplifiedTrack = {
      id: trackId,
      name: trackName,
      artist: artistName
    };

    const videosWithScores = videos.map((video: SimplifiedVideo) => {
      // Enhance video with parsed view count for accurate scoring
      const enhancedVideo: SimplifiedVideo = {
        ...video,
        viewCount: parseViewCount(video.description)
      };
      const { score, breakdown } = calculateMatchScore(spotifyTrack, enhancedVideo);
      return {
        ...video,
        matchScore: breakdown
      };
    });

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
        playlistId
      }
    );

    res.send(videoSelectionHtml);

  } catch (error) {
    Logger.error('Error searching for alternative videos', { trackId, trackName, artistName }, error);
    
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'danger',
      title: 'Error searching for videos',
      message: 'Unable to search for alternative videos. Please try again.',
      details: formatErrorDetails(error)
    });
    res.status(500).send(html);
  }
});

// Replace a video in a YouTube playlist
router.post('/replace/:trackId',
  csrfValidationMiddleware, // CSRF protection - re-enabled with improved logging
  validate({
    params: z.object({
      trackId: schemas.alphanumericId
    }),
    body: z.object({
      newVideoId: schemas.youtubeVideoId,
      currentVideoId: schemas.youtubeVideoId.optional().or(z.literal('')),
      playlistId: schemas.spotifyPlaylistId
    })
  }),
  async (req: ValidatedRequest<
    { trackId: string },
    Record<string, unknown>,
    { newVideoId: string; currentVideoId?: string; playlistId: string }
  >, res) => {
  const { trackId } = req.params;
  const { newVideoId, currentVideoId, playlistId } = req.body;
  
  Logger.requestStart('Video Replacement Request', {
    trackId,
    currentVideoId,
    newVideoId,
    playlistId
  });

  try {
    // Check authentication
    const youtubeTokens: YouTubeTokens | null = parseYouTubeTokenCookie(req.cookies.youtube_tokens, res);
    const spotifyTokens: SpotifyTokens | null = parseSpotifyTokenCookie(req.cookies.spotify_tokens, res);

    if (!youtubeTokens) {
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'YouTube Authentication Required',
        message: 'Please connect to YouTube first',
        details: 'Use the YouTube connection button at the top of the page to authenticate.'
      });
      return res.status(401).send(html);
    }

    if (!spotifyTokens) {
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'Spotify Authentication Required',
        message: 'Please connect to Spotify first',
        details: 'Use the Spotify connection button at the top of the page to authenticate.'
      });
      return res.status(401).send(html);
    }

    // Initialize YouTube API
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // We need to find the YouTube playlist that corresponds to this Spotify playlist
    // First, get the Spotify playlist name to construct the YouTube playlist name
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(spotifyTokens.refreshToken);
    
    const spotifyPlaylistData = await spotifyApi.getPlaylist(playlistId);
    const expectedYouTubePlaylistName = `${spotifyPlaylistData.body.name} (from Spotify)`;
    
    Logger.external('YouTube', 'Looking for playlist', { name: expectedYouTubePlaylistName });

    // Get all user's YouTube playlists to find the matching one (with pagination)
    let targetPlaylist: youtube_v3.Schema$Playlist | undefined = undefined;
    let nextPageToken: string | undefined = undefined;

    do {
      const playlistsResponse: youtube_v3.Schema$PlaylistListResponse = await youtube.playlists.list({
        part: ['snippet'],
        mine: true,
        maxResults: 50,
        pageToken: nextPageToken
      }).then(res => res.data);

      targetPlaylist = playlistsResponse.items?.find((playlist: youtube_v3.Schema$Playlist) =>
        playlist.snippet?.title === expectedYouTubePlaylistName
      );

      // If we found it, break early
      if (targetPlaylist) break;

      nextPageToken = playlistsResponse.nextPageToken || undefined;
    } while (nextPageToken);

    if (!targetPlaylist) {
      Logger.error('YouTube playlist not found', { name: expectedYouTubePlaylistName });
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'danger',
        title: 'Playlist not found',
        message: `Could not find YouTube playlist: "${expectedYouTubePlaylistName}"`,
        details: 'This playlist may not have been synced yet. Try syncing it from the Spotify playlists page first.'
      });
      return res.status(404).send(html);
    }

    Logger.external('YouTube', 'Found target playlist', { title: targetPlaylist.snippet?.title, id: targetPlaylist.id });

    // Check if this is adding a new video (unlinked track) or replacing an existing one
    const isAddingNewVideo = !currentVideoId || currentVideoId === '';

    if (isAddingNewVideo) {
      // ADD MODE: Simply add the new video to the end of the playlist
      Logger.info('Adding new video to playlist', { newVideoId, trackId, playlistTitle: targetPlaylist.snippet?.title });

      await youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId: targetPlaylist.id!,
            resourceId: {
              kind: 'youtube#video',
              videoId: newVideoId
            }
          }
        }
      });

      Logger.info('Added new video successfully', { newVideoId });
    } else {
      // REPLACE MODE: Find and replace the existing video
      Logger.info('Replacing existing video', { currentVideoId, newVideoId, playlistTitle: targetPlaylist.snippet?.title });

      // Get ALL playlist items to find the current video (with pagination)
      let playlistItemToReplace: youtube_v3.Schema$PlaylistItem | undefined = undefined;
      let nextPageToken: string | undefined = undefined;
      let itemsFetched = 0;

      do {
        const playlistItemsResponse: youtube_v3.Schema$PlaylistItemListResponse = await youtube.playlistItems.list({
          part: ['snippet', 'contentDetails'],
          playlistId: targetPlaylist.id!,
          maxResults: 50,
          pageToken: nextPageToken
        }).then(res => res.data);

        itemsFetched += playlistItemsResponse.items?.length || 0;

        // Look for the current video in this page
        playlistItemToReplace = playlistItemsResponse.items?.find((item: youtube_v3.Schema$PlaylistItem) =>
          item.snippet?.resourceId?.videoId === currentVideoId
        );

        // If we found it, break early
        if (playlistItemToReplace) {
          Logger.info('Found video to replace', { currentVideoId, itemsFetched });
          break;
        }

        nextPageToken = playlistItemsResponse.nextPageToken || undefined;
      } while (nextPageToken);

      if (!playlistItemToReplace) {
        Logger.error('Video not found in playlist after checking all pages', {
          currentVideoId,
          playlistTitle: targetPlaylist.snippet?.title,
          totalItemsChecked: itemsFetched
        });

        const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
          type: 'danger',
          title: 'Video not found',
          message: `Could not find the video in the YouTube playlist after checking all ${itemsFetched} items.`,
          details: 'The video may have been removed from the playlist, or the playlist data may be out of sync. Try refreshing the playlist details and trying again.'
        });
        return res.status(404).send(html);
      }

      // Get the position of the current video so we can maintain order
      const currentPosition = playlistItemToReplace.snippet?.position || 0;

      // Add the new video at the same position
      await youtube.playlistItems.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            playlistId: targetPlaylist.id!,
            position: currentPosition,
            resourceId: {
              kind: 'youtube#video',
              videoId: newVideoId
            }
          }
        }
      });

      Logger.info('Added new video', { newVideoId, position: currentPosition });

      // Remove the old video (it will now be at position + 1 due to the insert)
      await youtube.playlistItems.delete({
        id: playlistItemToReplace.id!
      });

      Logger.info('Removed old video', { currentVideoId });
    }

    Logger.info('Video operation completed successfully', { operation: isAddingNewVideo ? 'add' : 'replace' });

    // After adding or replacing a video, reorder the playlist to match Spotify order
    try {
      Logger.info('Starting playlist reordering after manual video link', {
        isAddingNewVideo,
        newVideoId,
        currentVideoId
      });

      // Wait for YouTube to process the changes (especially for additions)
      // YouTube can be slow to propagate, so we need a generous wait
      const waitTime = isAddingNewVideo ? 3000 : 1000;
      Logger.info('Waiting for YouTube to process changes before reordering', {
        waitTime,
        reason: isAddingNewVideo ? 'new video added' : 'video replaced'
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Fetch all Spotify tracks for the playlist
      // Note: reorderPlaylistTracks expects the full format with .track property
      const spotifyPlaylistResponse = await spotifyApi.getPlaylistTracks(playlistId, {
        limit: 50,
        offset: 0
      });

      // Keep the full format (with .track property) for reorderPlaylistTracks
      const spotifyTracks = spotifyPlaylistResponse.body.items;

      // Build list of synced tracks (tracks that have YouTube videos)
      // For simplicity, we'll fetch YouTube playlist again and match with Spotify
      const allPlaylistItems: youtube_v3.Schema$PlaylistItem[] = [];
      let pageToken: string | undefined = undefined;

      do {
        const response: youtube_v3.Schema$PlaylistItemListResponse = await youtube.playlistItems.list({
          part: ['snippet'],
          playlistId: targetPlaylist.id!,
          maxResults: 50,
          pageToken
        }).then(res => res.data);

        if (response.items) {
          allPlaylistItems.push(...response.items);
        }
        pageToken = response.nextPageToken || undefined;
      } while (pageToken);

      // Import track matching functionality
      const { optimalTrackMatching } = await import('../utils/trackMatching');

      // Extract track info from the full Spotify format
      const tracksToMatch = spotifyTracks
        .filter((item: any) => item.track && item.track.type === 'track')
        .map((item: any) => ({
          id: item.track.id,
          name: item.track.name,
          artist: item.track.artists[0]?.name || 'Unknown Artist'
        }));

      const existingVideos = allPlaylistItems
        .filter(item => item.snippet?.resourceId?.videoId && item.id)
        .map(item => ({
          id: item.snippet!.resourceId!.videoId!,
          title: item.snippet?.title || 'Unknown',
          description: item.snippet?.description || '',
          playlistItemId: item.id!
        }));

      const trackMatches = optimalTrackMatching(tracksToMatch, existingVideos);

      // Build synced tracks array
      // Need to use the full Spotify format with .track.id for matching
      const syncedTracks = [];
      for (const [trackId, videoInfo] of trackMatches.entries()) {
        const playlistItem = spotifyTracks.find((item: any) => item.track && item.track.id === trackId);
        if (playlistItem) {
          syncedTracks.push({
            track: playlistItem.track,
            matchedVideoId: videoInfo.id
          });
        }
      }

      Logger.info('Manual reordering data', {
        totalSpotifyItems: spotifyTracks.length,
        matchedTracks: trackMatches.size,
        syncedTracksCount: syncedTracks.length,
        syncedTrackDetails: syncedTracks.slice(0, 5).map((st: any) => ({
          trackName: st.track.name,
          artist: st.track.artists[0]?.name || 'Unknown',
          videoId: st.matchedVideoId
        }))
      });

      // Perform reordering
      if (syncedTracks.length > 0) {
        const { reorderedCount } = await reorderPlaylistTracks(
          youtube,
          targetPlaylist.id!,
          spotifyTracks,
          syncedTracks
        );

        Logger.info('Manual playlist reordering completed', {
          reorderedCount,
          syncedTracksProcessed: syncedTracks.length
        });
      } else {
        Logger.warn('No synced tracks found for reordering during manual link', {
          matchesFound: trackMatches.size,
          spotifyTracksCount: spotifyTracks.length
        });
      }

    } catch (reorderError) {
      // Log the error but don't fail the entire operation
      Logger.error('Error reordering playlist after manual video link', {}, reorderError);
    }

    const successMessage = isAddingNewVideo
      ? 'Video linked successfully!'
      : 'Video replaced successfully!';

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/video-replace-success.ejs'), {
      message: successMessage
    });

    res.send(html);

  } catch (error) {
    Logger.error('Error replacing video', { trackId, currentVideoId, newVideoId }, error);

    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'danger',
      title: 'Video replacement failed',
      message: 'Unable to update the playlist. Please try again.',
      details: formatErrorDetails(error)
    });
    res.status(500).send(html);
  }
});

export { router as playlistDetailsRouter };
