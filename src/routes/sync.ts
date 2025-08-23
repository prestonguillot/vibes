import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { searchMusicVideo } from '../utils/youtubeScraper';
import { sendProgressUpdate } from './progress';
import { Logger } from '../utils/logger';

const router = Router();

// Helper functions for token refresh
const ensureValidSpotifyToken = async (req: any) => {
  if (!req.session.spotifyTokens) {
    throw new Error('No Spotify tokens found');
  }

  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI
  });
  
  spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
  spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);

  try {
    await spotifyApi.getMe();
    return spotifyApi;
  } catch (error: any) {
    if (error.statusCode === 401 && req.session.spotifyTokens.refreshToken) {
      Logger.auth('Spotify', 'token expired, refreshing');
      try {
        const data = await spotifyApi.refreshAccessToken();
        const { access_token } = data.body;
        
        req.session.spotifyTokens.accessToken = access_token;
        spotifyApi.setAccessToken(access_token);
        
        Logger.auth('Spotify', 'token refreshed successfully');
        return spotifyApi;
      } catch (refreshError) {
        Logger.error('Failed to refresh Spotify token', {}, refreshError);
        throw new Error('SPOTIFY_AUTH_REQUIRED');
      }
    } else {
      throw new Error('SPOTIFY_AUTH_REQUIRED');
    }
  }
};

// Helper function to ensure valid YouTube token and return quota usage
async function ensureValidYouTubeToken(req: any): Promise<{ oauth2Client: any, quotaUsed: number }> {
  if (!req.session.youtubeTokens) {
    throw new Error('YOUTUBE_AUTH_REQUIRED');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );

  oauth2Client.setCredentials(req.session.youtubeTokens);

  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    await youtube.channels.list({ part: ['id'], mine: true, maxResults: 1 });
    Logger.external('YouTube', 'Token validation successful', { quotaUsed: 1 });
    return { oauth2Client, quotaUsed: 1 }; // channels.list costs 1 unit
  } catch (error: any) {
    if (error.code === 401 && req.session.youtubeTokens.refresh_token) {
      Logger.auth('YouTube', 'token expired, refreshing');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        req.session.youtubeTokens = {
          ...req.session.youtubeTokens,
          ...credentials
        };
        oauth2Client.setCredentials(req.session.youtubeTokens);
        
        Logger.auth('YouTube', 'token refreshed successfully');
        return { oauth2Client, quotaUsed: 1 }; // refreshAccessToken costs 1 unit
      } catch (refreshError) {
        Logger.error('Failed to refresh YouTube token', {}, refreshError);
        throw new Error('YOUTUBE_AUTH_REQUIRED');
      }
    } else {
      throw new Error('YOUTUBE_AUTH_REQUIRED');
    }
  }
};

router.post('/playlist/:playlistId', async (req, res) => {
  const startTime = Date.now();
  const playlistId = req.params.playlistId;
  
  Logger.requestStart('Sync Request Started', {
    playlistId,
    sessionId: req.sessionID,
    requestUrl: req.originalUrl,
    method: req.method
  });

  // Send initial progress update
  sendProgressUpdate(playlistId, {
    type: 'progress',
    message: 'Starting sync...',
    details: 'Checking authentication and initializing APIs'
  });

  try {
    // Check authentication
    if (!req.session.spotifyTokens) {
      Logger.error('No Spotify tokens in session');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Authentication required',
        details: 'Please connect to Spotify first'
      });
      return res.status(401).send('<div class="alert alert-danger">Please connect to Spotify first</div>');
    }
    
    if (!req.session.youtubeTokens) {
      Logger.error('No YouTube tokens in session');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Authentication required',
        details: 'Please connect to YouTube first'
      });
      return res.status(401).send('<div class="alert alert-danger">Please connect to YouTube first</div>');
    }

    Logger.info('Authentication check passed');
    
    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: 'Authentication verified',
      details: 'Initializing API clients...'
    });

    // Initialize APIs
    Logger.info('Initializing API clients');
    const spotifyApi = await ensureValidSpotifyToken(req);
    const { oauth2Client, quotaUsed } = await ensureValidYouTubeToken(req);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    Logger.info('API clients initialized');

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: 'APIs initialized',
      details: 'Fetching Spotify playlist details...'
    });

    // Get playlist details
    Logger.external('Spotify', 'Fetching playlist details');
    const playlistResponse = await spotifyApi.getPlaylist(playlistId);
    const playlist = playlistResponse.body;
    Logger.external('Spotify', 'Playlist details fetched', { name: playlist.name, totalTracks: playlist.tracks.total });

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Found playlist: "${playlist.name}"`,
      details: `Fetching tracks (limit: 10)...`
    });

    // Get tracks with limit
    const trackLimit = 10; // Conservative limit for testing - now 10 tracks
    Logger.external('Spotify', 'Fetching tracks', { limit: trackLimit });
    const tracksResponse = await spotifyApi.getPlaylistTracks(playlistId, { limit: trackLimit });
    const tracks = tracksResponse.body.items.filter(item => item.track && item.track.type === 'track');
    Logger.info('Found valid tracks to sync', { count: tracks.length });

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Processing ${tracks.length} tracks`,
      details: 'Searching for existing YouTube playlist...',
      currentTrack: 0,
      totalTracks: tracks.length
    });

    if (tracks.length === 0) {
      Logger.warn('No tracks to sync');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'No tracks found',
        details: 'No tracks found in the playlist'
      });
      return res.send('<div class="alert alert-warning">No tracks found to sync</div>');
    }

    // Search for YouTube videos using web scraping (no API quota cost!)
    const videoIds: string[] = [];
    const searchResults: Array<{track: string, artist: string, found: boolean, videoId?: string}> = [];
    let searchCount = 0;
    
    // Calculate total progress phases: search (70%) + playlist operations (30%)
    const SEARCH_PHASE_WEIGHT = 0.7;
    const PLAYLIST_PHASE_WEIGHT = 0.3;
    
    Logger.info('Starting YouTube scraping', { trackCount: tracks.length });
    
    for (const item of tracks) {
      if (item.track && item.track.type === 'track') {
        const track = item.track;
        const artist = track.artists[0]?.name || 'Unknown Artist';
        const songName = track.name;
        
        try {
          Logger.debug('Searching for track', { trackNumber: searchCount + 1, totalTracks: tracks.length, artist, songName });
          
          // Send progress update with current song info (search phase: 0-70% of total)
          const searchProgress = (searchCount / tracks.length) * SEARCH_PHASE_WEIGHT;
          const totalPercentage = Math.round(searchProgress * 100);
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Finding music videos`,
            details: `Searching for "${songName}" by ${artist}... (${searchCount + 1}/${tracks.length})`,
            currentTrack: searchCount + 1,
            totalTracks: tracks.length,
            currentSong: songName,
            currentArtist: artist,
            percentage: totalPercentage
          });
          
          const videoId = await searchMusicVideo(artist, songName);
          searchCount++;
          
          if (videoId) {
            videoIds.push(videoId);
            searchResults.push({
              track: songName,
              artist: artist,
              found: true,
              videoId: videoId
            });
            Logger.info('Found video for track', { songName, artist, videoId });
          } else {
            searchResults.push({
              track: songName,
              artist: artist,
              found: false
            });
            Logger.warn('No video found for track', { songName, artist });
          }
          
          // Rate limiting: add delay between searches to be respectful
          if (searchCount < tracks.length) {
            Logger.debug('Rate limiting delay', { delayMs: 100 });
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          searchCount++;
          Logger.error('Error searching for track', { artist, songName }, error);
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error searching for video',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
          searchResults.push({
            track: songName,
            artist: artist,
            found: false
          });
        }
      }
    }
    
    Logger.info('Scraping completed', { searchesMade: searchCount, videosFound: videoIds.length, quotaSaved: searchCount * 100 });
    
    // After search phase completes, we're at 70% progress
    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Found ${videoIds.length} music videos`,
      details: 'Checking for existing YouTube playlist...',
      percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
    });
    
    // Track API calls and quota usage accurately
    let apiCallCount = 0;
    let totalQuotaUsed = quotaUsed;
    
    // Helper function to log API calls with correct quota costs
    const logApiCall = (operation: string, quotaCost: number) => {
      apiCallCount++;
      totalQuotaUsed += quotaCost;
      Logger.external('YouTube', `API call: ${operation}`, { callNumber: apiCallCount, quotaCost, totalQuotaUsed });
    };
    
    // Check if a YouTube playlist already exists for this Spotify playlist
    const playlistTitle = `${playlist.name} (from Spotify)`;
    Logger.external('YouTube', 'Searching for existing playlist', { title: playlistTitle });
    
    let existingPlaylist: any = null;
    let youtubePlaylistId: string;
    
    try {
      const existingPlaylists = await youtube.playlists.list({
        part: ['id', 'snippet'],
        mine: true,
        maxResults: 50
      });
      
      logApiCall('playlist search', 1); // playlists.list costs 1 unit
      
      if (existingPlaylists.data.items) {
        existingPlaylist = existingPlaylists.data.items.find(p => 
          p.snippet?.title === playlistTitle
        );
      }
      
      if (existingPlaylist) {
        youtubePlaylistId = existingPlaylist.id!;
        Logger.external('YouTube', 'Found existing playlist', { title: playlistTitle, id: youtubePlaylistId });
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `Found existing playlist: "${playlistTitle}"`,
          details: 'Adding new videos to existing playlist...',
          percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
        });
      } else {
        Logger.info('No existing playlist found, will create new one');
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `Creating new YouTube playlist`,
          details: 'Setting up new playlist...',
          percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
        });
      }
    } catch (error) {
      Logger.error('Error checking for existing playlist', {}, error);
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Error checking for existing playlist',
        details: error instanceof Error ? error.message : 'An unexpected error occurred'
      });
      throw error;
    }
    
    // Only create playlist if we found some videos
    if (videoIds.length === 0) {
      Logger.warn('No videos found');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'No videos found',
        details: 'No videos found in the playlist'
      });
      return res.send(`
        <div class="alert alert-warning">
          <h5>No videos found</h5>
          <p>Could not find any YouTube videos for the tracks in this playlist.</p>
          <p>API calls made: ${apiCallCount} (${totalQuotaUsed} quota units)</p>
        </div>
      `);
    }
    
    // Create playlist if it doesn't exist
    if (!existingPlaylist) {
      const playlistResponse = await youtube.playlists.insert({
        part: ['snippet', 'status'],
        requestBody: {
          snippet: {
            title: playlistTitle,
            description: `Synced from Spotify playlist: ${playlist.name}`,
          },
          status: {
            privacyStatus: 'private',
          }
        }
      });
      
      logApiCall('playlist creation', 50); // playlists.insert costs 50 units
      
      youtubePlaylistId = playlistResponse.data.id!;
      Logger.external('YouTube', 'Created new playlist', { title: playlistTitle, id: youtubePlaylistId });
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Created playlist: "${playlistTitle}"`,
        details: 'Adding videos to new playlist...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
      
      // Add all videos to the new playlist
      for (const videoId of videoIds) {
        try {
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: videoId,
                }
              }
            }
          });
          logApiCall('add video to new playlist', 50); // playlistItems.insert costs 50 units
          Logger.external('YouTube', 'Added video to new playlist', { videoId });
          const currentIndex = videoIds.indexOf(videoId) + 1;
          // Calculate total progress: 70% (search complete) + 30% * (current/total) for playlist phase
          const playlistProgress = (currentIndex / videoIds.length) * PLAYLIST_PHASE_WEIGHT;
          const totalPercentage = Math.round((SEARCH_PHASE_WEIGHT + playlistProgress) * 100);
          
          // Find the corresponding song info for this video
          const videoResult = searchResults.find(result => result.videoId === videoId);
          const songName = videoResult?.track || 'Unknown Song';
          const artistName = videoResult?.artist || 'Unknown Artist';
          
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Adding videos to playlist`,
            details: `Adding "${songName}" by ${artistName} (${currentIndex}/${videoIds.length})`,
            currentTrack: currentIndex,
            totalTracks: videoIds.length,
            currentSong: songName,
            currentArtist: artistName,
            percentage: totalPercentage
          });
        } catch (error) {
          Logger.error('Error adding video to playlist', { videoId }, error);
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error adding video to playlist',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
        }
      }
      
    } else {
      // Smart sync for existing playlist - check for duplicates
      Logger.info('Performing smart sync on existing playlist');
      
      // Get existing videos in the playlist
      const existingItems = await youtube.playlistItems.list({
        part: ['id', 'snippet'],
        playlistId: youtubePlaylistId,
        maxResults: 50
      });
      
      logApiCall('get existing items', 1); // playlistItems.list costs 1 unit
      
      const existingVideos = existingItems.data.items || [];
      Logger.info('Found existing videos in playlist', { count: existingVideos.length });
      
      // Create a set of existing video IDs for fast lookup
      const existingVideoIds = new Set<string>();
      for (const item of existingVideos) {
        if (item.snippet?.resourceId?.videoId) {
          existingVideoIds.add(item.snippet.resourceId.videoId);
        }
      }
      
      Logger.debug('Existing video IDs', { videoIds: Array.from(existingVideoIds) });
      
      // Only add videos that don't already exist
      const videosToAdd = videoIds.filter(videoId => !existingVideoIds.has(videoId));
      const duplicateVideos = videoIds.filter(videoId => existingVideoIds.has(videoId));
      
      Logger.info('Smart sync analysis', {
        totalVideosFound: videoIds.length,
        alreadyInPlaylist: duplicateVideos.length,
        newVideosToAdd: videosToAdd.length
      });
      
      if (duplicateVideos.length > 0) {
        Logger.debug('Skipping duplicate videos', { duplicates: duplicateVideos });
      }
      
      // Add only the new videos
      let addedCount = 0;
      for (const videoId of videosToAdd) {
        try {
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: videoId,
                }
              }
            }
          });
          logApiCall('add new video', 50); // playlistItems.insert costs 50 units
          addedCount++;
          Logger.external('YouTube', 'Added new video to existing playlist', { videoId });
          // Calculate total progress: 70% (search complete) + 30% * (current/total) for playlist phase
          const playlistProgress = (addedCount / videosToAdd.length) * PLAYLIST_PHASE_WEIGHT;
          const totalPercentage = Math.round((SEARCH_PHASE_WEIGHT + playlistProgress) * 100);
          
          // Find the corresponding song info for this video
          const videoResult = searchResults.find(result => result.videoId === videoId);
          const songName = videoResult?.track || 'Unknown Song';
          const artistName = videoResult?.artist || 'Unknown Artist';
          
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Adding new videos to playlist`,
            details: `Adding "${songName}" by ${artistName} (${addedCount}/${videosToAdd.length})`,
            currentTrack: addedCount,
            totalTracks: videosToAdd.length,
            currentSong: songName,
            currentArtist: artistName,
            percentage: totalPercentage
          });
        } catch (error) {
          Logger.error('Error adding video to existing playlist', { videoId }, error);
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error adding video to playlist',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
        }
      }
      
      Logger.info('Smart sync completed', { newVideosAdded: addedCount, duplicatesSkipped: duplicateVideos.length });
    }
    
    Logger.requestEnd('Sync Request Completed', { processingTimeMs: Date.now() - startTime });
    
    // Send completion progress update
    const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${youtubePlaylistId}`;
    sendProgressUpdate(playlistId, {
      type: 'complete',
      message: `Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!`,
      details: `Found ${searchResults.filter(r => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}`,
      currentTrack: searchResults.length,
      totalTracks: searchResults.length,
      percentage: 100
    });
    
    // Log comprehensive YouTube API quota usage summary
    Logger.info('YouTube API Quota Usage Summary', {
      totalApiCalls: apiCallCount,
      totalQuotaUsed,
      operationType: existingPlaylist ? 'UPDATE' : 'SYNC',
      playlistName: playlist.name,
      playlistId,
      tracksProcessed: searchResults.length,
      tracksLimited: tracks.length > trackLimit,
      totalTracks: tracks.length,
      videosFound: searchResults.filter(r => r.found).length,
      scraperSearches: searchResults.length,
      quotaSaved: searchResults.length * 100
    });
    
    // Generate user-friendly sync feedback
    const syncFeedbackHtml = `
      <div class="sync-feedback alert alert-success alert-dismissible fade show" data-playlist-id="${playlistId}">
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        <div><strong>Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!</strong></div>
        <div class="small">Found ${searchResults.filter(r => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}</div>
      </div>
    `;
    
    // Return response with both feedback and refresh trigger
    res.send(`
      <div data-sync-success="true" data-playlist-id="${playlistId}" data-feedback-html="${encodeURIComponent(syncFeedbackHtml)}">
        ${syncFeedbackHtml}
      </div>
    `);
    
  } catch (error) {
    Logger.error('Error syncing playlist', { processingTimeMs: Date.now() - startTime }, error);
    
    // Send error progress update
    sendProgressUpdate(playlistId, {
      type: 'error',
      message: 'Sync failed',
      details: error instanceof Error ? error.message : 'An unexpected error occurred'
    });
    
    // Log YouTube API quota usage summary even on error
    Logger.error('YouTube API Quota Usage Summary (ERROR)', {
      totalApiCalls: apiCallCount,
      totalQuotaUsed,
      operationAttempted: existingPlaylist ? 'UPDATE' : 'SYNC'
    });
    
    // Check if it's an authentication error
    if (error instanceof Error && (
      error.message === 'SPOTIFY_AUTH_REQUIRED' || 
      error.message === 'YOUTUBE_AUTH_REQUIRED'
    )) {
      const service = error.message === 'SPOTIFY_AUTH_REQUIRED' ? 'Spotify' : 'YouTube';
      const loginUrl = error.message === 'SPOTIFY_AUTH_REQUIRED' ? 
        '/auth/spotify/login' : '/auth/youtube/login';
      
      return res.status(401).send(`
        <div class="alert alert-warning">
          <h5>Authentication Required</h5>
          <p>${service} session has expired. Please reconnect to continue syncing.</p>
          <button class="btn btn-success btn-sm" onclick="window.location.href='${loginUrl}'">
            Reconnect to ${service}
          </button>
        </div>
      `);
    }
    
    res.status(500).send(`
      <div class="alert alert-danger">
        <h5>Error syncing playlist</h5>
        <p>Something went wrong during the sync process. Please try again.</p>
        <small class="text-muted">Error: ${error instanceof Error ? error.message : 'Unknown error'}</small>
      </div>
    `);
  }
});

export { router as syncRouter };
