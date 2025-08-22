import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { searchMusicVideo } from '../utils/youtubeScraper';
import { sendProgressUpdate } from './progress';

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
      console.log('Spotify token expired, refreshing...');
      try {
        const data = await spotifyApi.refreshAccessToken();
        const { access_token } = data.body;
        
        req.session.spotifyTokens.accessToken = access_token;
        spotifyApi.setAccessToken(access_token);
        
        console.log('Spotify token refreshed successfully');
        return spotifyApi;
      } catch (refreshError) {
        console.error('Failed to refresh Spotify token:', refreshError);
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
    console.log('✅ YouTube token validation - 1 quota unit');
    return { oauth2Client, quotaUsed: 1 }; // channels.list costs 1 unit
  } catch (error: any) {
    if (error.code === 401 && req.session.youtubeTokens.refresh_token) {
      console.log('YouTube token expired, refreshing...');
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        req.session.youtubeTokens = {
          ...req.session.youtubeTokens,
          ...credentials
        };
        oauth2Client.setCredentials(req.session.youtubeTokens);
        
        console.log('YouTube token refreshed successfully');
        return { oauth2Client, quotaUsed: 1 }; // refreshAccessToken costs 1 unit
      } catch (refreshError) {
        console.error('Failed to refresh YouTube token:', refreshError);
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
  
  console.log(`\n🚀 === SYNC REQUEST STARTED ===`);
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`🎵 Playlist ID: ${playlistId}`);
  console.log(`👤 Session ID: ${req.sessionID}`);
  console.log(`🔗 Request URL: ${req.originalUrl}`);
  console.log(`📊 Request method: ${req.method}`);

  // Send initial progress update
  sendProgressUpdate(playlistId, {
    type: 'progress',
    message: 'Starting sync...',
    details: 'Checking authentication and initializing APIs'
  });

  try {
    // Check authentication
    if (!req.session.spotifyTokens) {
      console.log('❌ No Spotify tokens in session');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Authentication required',
        details: 'Please connect to Spotify first'
      });
      return res.status(401).send('<div class="alert alert-danger">Please connect to Spotify first</div>');
    }
    
    if (!req.session.youtubeTokens) {
      console.log('❌ No YouTube tokens in session');
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Authentication required',
        details: 'Please connect to YouTube first'
      });
      return res.status(401).send('<div class="alert alert-danger">Please connect to YouTube first</div>');
    }

    console.log('✅ Authentication check passed');
    
    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: 'Authentication verified',
      details: 'Initializing API clients...'
    });

    // Initialize APIs
    console.log('🔧 Initializing API clients...');
    const spotifyApi = await ensureValidSpotifyToken(req);
    const { oauth2Client, quotaUsed } = await ensureValidYouTubeToken(req);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    console.log('✅ API clients initialized');

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: 'APIs initialized',
      details: 'Fetching Spotify playlist details...'
    });

    // Get playlist details
    console.log('📋 Fetching Spotify playlist details...');
    const playlistResponse = await spotifyApi.getPlaylist(playlistId);
    const playlist = playlistResponse.body;
    console.log(`📋 Playlist: "${playlist.name}" (${playlist.tracks.total} tracks)`);

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Found playlist: "${playlist.name}"`,
      details: `Fetching tracks (limit: 10)...`
    });

    // Get tracks with limit
    const trackLimit = 10; // Conservative limit for testing - now 10 tracks
    console.log(`🎵 Fetching tracks (limit: ${trackLimit})...`);
    const tracksResponse = await spotifyApi.getPlaylistTracks(playlistId, { limit: trackLimit });
    const tracks = tracksResponse.body.items.filter(item => item.track && item.track.type === 'track');
    console.log(`🎵 Found ${tracks.length} valid tracks to sync`);

    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Processing ${tracks.length} tracks`,
      details: 'Searching for existing YouTube playlist...',
      currentTrack: 0,
      totalTracks: tracks.length
    });

    if (tracks.length === 0) {
      console.log('⚠️ No tracks to sync');
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
    
    console.log(`🕷️ Starting YouTube scraping for ${tracks.length} tracks`);
    
    for (const item of tracks) {
      if (item.track && item.track.type === 'track') {
        const track = item.track;
        const artist = track.artists[0]?.name || 'Unknown Artist';
        const songName = track.name;
        
        try {
          console.log(`🎵 Track ${searchCount + 1}/${tracks.length}: ${artist} - ${songName}`);
          
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
            console.log(`✅ Found video for "${songName}" by ${artist}: ${videoId}`);
          } else {
            searchResults.push({
              track: songName,
              artist: artist,
              found: false
            });
            console.log(`❌ No video found for "${songName}" by ${artist}`);
          }
          
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Processing ${tracks.length} tracks`,
            details: `Searching for YouTube videos... (${searchCount}/${tracks.length})`,
            currentTrack: searchCount,
            totalTracks: tracks.length
          });
          
          // Rate limiting: add delay between searches to be respectful
          if (searchCount < tracks.length) {
            console.log(`⏳ Rate limiting: waiting 100ms before next search...`);
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
        } catch (error) {
          searchCount++;
          console.error(`❌ Error searching for ${artist} - ${songName}:`, error);
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
    
    console.log(`🕷️ Scraping completed: ${searchCount} searches made, ${videoIds.length} videos found`);
    console.log(`💰 Cost savings: Avoided ${searchCount * 100} YouTube API quota units!`);
    
    sendProgressUpdate(playlistId, {
      type: 'progress',
      message: `Found ${videoIds.length} YouTube videos`,
      details: 'Checking for existing YouTube playlist...'
    });
    
    // Track API calls and quota usage accurately
    let apiCallCount = 0;
    let totalQuotaUsed = quotaUsed;
    
    // Helper function to log API calls with correct quota costs
    const logApiCall = (operation: string, quotaCost: number) => {
      apiCallCount++;
      totalQuotaUsed += quotaCost;
      console.log(`API call #${apiCallCount} (${operation}) - ${quotaCost} quota units (total: ${totalQuotaUsed})`);
    };
    
    // Check if a YouTube playlist already exists for this Spotify playlist
    const playlistTitle = `${playlist.name} (from Spotify)`;
    console.log(`🔍 Searching for existing YouTube playlist: "${playlistTitle}"`);
    
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
        console.log(`📺 Found existing playlist: "${playlistTitle}" (${youtubePlaylistId})`);
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `Found existing YouTube playlist: "${playlistTitle}"`,
          details: 'Adding videos to existing playlist...'
        });
      } else {
        console.log(`📺 No existing playlist found, will create new one`);
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `No existing YouTube playlist found`,
          details: 'Creating new playlist...'
        });
      }
    } catch (error) {
      console.error('Error checking for existing playlist:', error);
      sendProgressUpdate(playlistId, {
        type: 'error',
        message: 'Error checking for existing playlist',
        details: error instanceof Error ? error.message : 'An unexpected error occurred'
      });
      throw error;
    }
    
    // Only create playlist if we found some videos
    if (videoIds.length === 0) {
      console.log('⚠️ No videos found');
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
      console.log(`Created new YouTube playlist: ${playlistTitle} (${youtubePlaylistId})`);
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Created new YouTube playlist: "${playlistTitle}"`,
        details: 'Adding videos to new playlist...'
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
          console.log(`Added video to new playlist: ${videoId}`);
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Adding videos to playlist...`,
            details: `Added video: ${videoId}`,
            currentTrack: videoIds.indexOf(videoId) + 1,
            totalTracks: videoIds.length
          });
        } catch (error) {
          console.error(`Error adding video ${videoId} to playlist:`, error);
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error adding video to playlist',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
        }
      }
      
    } else {
      // Smart sync for existing playlist - check for duplicates
      console.log(`🔄 Performing smart sync on existing playlist...`);
      
      // Get existing videos in the playlist
      const existingItems = await youtube.playlistItems.list({
        part: ['id', 'snippet'],
        playlistId: youtubePlaylistId,
        maxResults: 50
      });
      
      logApiCall('get existing items', 1); // playlistItems.list costs 1 unit
      
      const existingVideos = existingItems.data.items || [];
      console.log(`📋 Found ${existingVideos.length} existing videos in playlist`);
      
      // Create a set of existing video IDs for fast lookup
      const existingVideoIds = new Set<string>();
      for (const item of existingVideos) {
        if (item.snippet?.resourceId?.videoId) {
          existingVideoIds.add(item.snippet.resourceId.videoId);
        }
      }
      
      console.log(`🔍 Existing video IDs: ${Array.from(existingVideoIds).join(', ')}`);
      
      // Only add videos that don't already exist
      const videosToAdd = videoIds.filter(videoId => !existingVideoIds.has(videoId));
      const duplicateVideos = videoIds.filter(videoId => existingVideoIds.has(videoId));
      
      console.log(`📊 Smart sync analysis:`);
      console.log(`   - Total videos found: ${videoIds.length}`);
      console.log(`   - Already in playlist: ${duplicateVideos.length}`);
      console.log(`   - New videos to add: ${videosToAdd.length}`);
      
      if (duplicateVideos.length > 0) {
        console.log(`⏭️  Skipping duplicates: ${duplicateVideos.join(', ')}`);
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
          console.log(`✅ Added new video to existing playlist: ${videoId}`);
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Adding videos to playlist...`,
            details: `Added video: ${videoId}`,
            currentTrack: addedCount,
            totalTracks: videosToAdd.length
          });
        } catch (error) {
          console.error(`❌ Error adding video ${videoId} to playlist:`, error);
          sendProgressUpdate(playlistId, {
            type: 'error',
            message: 'Error adding video to playlist',
            details: error instanceof Error ? error.message : 'An unexpected error occurred'
          });
        }
      }
      
      console.log(`🎯 Smart sync completed: ${addedCount} new videos added, ${duplicateVideos.length} duplicates skipped`);
    }
    
    console.log(`🕒 Request processing time: ${Date.now() - startTime}ms`);
    
    // Send completion progress update
    const youtubePlaylistUrl = `https://www.youtube.com/playlist?list=${youtubePlaylistId}`;
    sendProgressUpdate(playlistId, {
      type: 'complete',
      message: `Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!`,
      details: `Found ${searchResults.filter(r => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}`,
      currentTrack: searchResults.length,
      totalTracks: searchResults.length
    });
    
    // Log comprehensive YouTube API quota usage summary
    console.log(`📊 YouTube API Quota Usage Summary:`);
    console.log(`   Total API calls made: ${apiCallCount}`);
    console.log(`   Total quota units used: ${totalQuotaUsed}`);
    console.log(`   Operation type: ${existingPlaylist ? 'UPDATE' : 'SYNC'} playlist`);
    console.log(`   Playlist: "${playlist.name}" (${playlistId})`);
    console.log(`   Tracks processed: ${searchResults.length}${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}`);
    console.log(`   Videos found: ${searchResults.filter(r => r.found).length}`);
    console.log(`   Scraper searches: ${searchResults.length} (saved ${searchResults.length * 100} quota units vs API search)`);
    
    // Generate user-friendly sync feedback with YouTube playlist link
    const syncFeedbackHtml = `
      <div class="sync-feedback alert alert-success alert-dismissible fade show" data-playlist-id="${playlistId}">
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        <div><strong>Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!</strong></div>
        <div class="small">Found ${searchResults.filter(r => r.found).length} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}</div>
        <div class="small mt-2">
          <a href="${youtubePlaylistUrl}" target="_blank" class="btn btn-outline-primary btn-sm">
            Open YouTube Playlist
          </a>
        </div>
      </div>
    `;
    
    // Return response with both feedback and refresh trigger
    res.send(`
      <div data-sync-success="true" data-playlist-id="${playlistId}" data-feedback-html="${encodeURIComponent(syncFeedbackHtml)}">
        ${syncFeedbackHtml}
      </div>
    `);
    
  } catch (error) {
    console.error('Error syncing playlist:', error);
    console.log(`🕒 Request processing time: ${Date.now() - startTime}ms`);
    
    // Send error progress update
    sendProgressUpdate(playlistId, {
      type: 'error',
      message: 'Sync failed',
      details: error instanceof Error ? error.message : 'An unexpected error occurred'
    });
    
    // Log YouTube API quota usage summary even on error
    console.log(`📊 YouTube API Quota Usage Summary (ERROR):`);
    console.log(`   Total API calls made: ${apiCallCount}`);
    console.log(`   Total quota units used: ${totalQuotaUsed}`);
    console.log(`   Operation attempted: ${existingPlaylist ? 'UPDATE' : 'SYNC'} playlist`);
    
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
