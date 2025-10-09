import { Router } from 'express';
import SpotifyWebApi from 'spotify-web-api-node';
import { google } from 'googleapis';
import { searchMusicVideo } from '../utils/youtubeScraper';
import { sendProgressUpdate } from './progress';
import { Logger } from '../utils/logger';

const router = Router();

// Track matching functions (from playlist details)
function findBestMatch(spotifyTrack: any, youtubeVideos: any[]) {
  let bestMatch = null;
  let bestScore = 0;
  const minScore = 0.4; // Minimum similarity threshold
  
  for (const video of youtubeVideos) {
    const score = calculateMatchScore(spotifyTrack, video);
    if (score > bestScore && score >= minScore) {
      bestScore = score;
      bestMatch = video;
    }
  }
  
  return bestMatch;
}

function calculateMatchScore(spotifyTrack: any, youtubeVideo: any): number {
  // Extract core titles by removing metadata
  const coreTrackName = extractCoreTitle(spotifyTrack.name);
  const coreArtistName = normalizeText(spotifyTrack.artist);
  const coreVideoTitle = extractCoreTitle(youtubeVideo.title);
  
  let score = 0;
  
  // Strategy 1: Core track title exact match (highest priority)
  if (coreVideoTitle.includes(coreTrackName) || coreTrackName.includes(coreVideoTitle)) {
    score += 0.8;
    
    // Bonus if artist also matches
    if (coreVideoTitle.includes(coreArtistName) || youtubeVideo.title.toLowerCase().includes(coreArtistName)) {
      score += 0.15;
    }
  }
  
  // Strategy 2: Fuzzy core title matching (handles minor variations)
  const titleSimilarity = calculateStringSimilarity(coreTrackName, coreVideoTitle);
  if (titleSimilarity > 0.8) {
    score += 0.7 * titleSimilarity;
    
    // Bonus if artist matches
    if (coreVideoTitle.includes(coreArtistName) || youtubeVideo.title.toLowerCase().includes(coreArtistName)) {
      score += 0.2;
    }
  }
  
  // Strategy 3: Word-by-word core matching
  const trackCoreWords = coreTrackName.split(' ').filter(w => w.length > 2);
  const videoCoreWords = coreVideoTitle.split(' ').filter(w => w.length > 2);
  
  if (trackCoreWords.length > 0) {
    const coreWordMatches = trackCoreWords.filter(word => 
      videoCoreWords.some(vw => 
        vw === word || vw.includes(word) || word.includes(vw) ||
        calculateStringSimilarity(word, vw) > 0.85
      )
    ).length;
    
    const coreMatchRatio = coreWordMatches / trackCoreWords.length;
    if (coreMatchRatio > 0.5) {
      score += 0.5 * coreMatchRatio;
    }
  }
  
  // Strategy 4: Artist name matching (secondary)
  const videoTitle = normalizeText(youtubeVideo.title);
  if (videoTitle.includes(coreArtistName)) {
    score += 0.2;
  }
  
  return Math.min(score, 1.0);
}

function extractCoreTitle(title: string): string {
  let coreTitle = normalizeText(title);
  
  // Remove everything after common metadata indicators
  const metadataPatterns = [
    /\s*-\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*$/i,
    /\s*\(\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*\).*$/i,
    /\s*\[\s*(remaster|live|acoustic|demo|radio|edit|mix|version|instrumental).*\].*$/i,
    /\s*-\s*\d{4}.*$/i, // Remove "- 2016 Remaster" etc.
    /\s*\(\s*\d{4}.*\).*$/i, // Remove "(2016 Remaster)" etc.
    /\s*\[\s*\d{4}.*\].*$/i, // Remove "[2016 Remaster]" etc.
    /\s*\(\s*with\s+.*?\).*$/i, // Remove "(with Artist)" 
    /\s*\(\s*feat\.?\s+.*?\).*$/i, // Remove "(feat. Artist)"
    /\s*-\s*live\s+at.*$/i, // Remove "- Live at Venue"
    /\s*\(\s*live\s+at.*\).*$/i, // Remove "(Live at Venue)"
    /\s*,\s*pt\.?\s*\d+.*$/i, // Keep "Pt. 2" but remove metadata after it
  ];
  
  for (const pattern of metadataPatterns) {
    coreTitle = coreTitle.replace(pattern, '').trim();
  }
  
  // Special handling for "Pt." - keep it but remove what comes after
  coreTitle = coreTitle.replace(/(\s*,?\s*pt\.?\s*\d+).*$/i, '$1');
  
  // Clean up any remaining artifacts
  coreTitle = coreTitle
    .replace(/\s*-\s*$/, '') // Remove trailing dashes
    .replace(/\s*,\s*$/, '') // Remove trailing commas
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
  
  return coreTitle;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .replace(/\b(official|video|audio|live|remix|version|ft|feat|featuring)\b/g, '') // Remove common extra words
    .trim();
}

function calculateStringSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1.0;
  
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = calculateLevenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function calculateLevenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

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

  // Declare variables outside try block so they're accessible in catch
  let apiCallCount = 0;
  let totalQuotaUsed = 0;
  let existingPlaylist: any = null;

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
    totalQuotaUsed = quotaUsed; // Initialize totalQuotaUsed with initial quota
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

    // Get batch size from request, default to 1 if not provided
    const batchSize = req.body.batchSize ? parseInt(req.body.batchSize) : 1;
    const trackLimit = batchSize; // Use user-selected batch size
    
    Logger.info('Using user-selected batch size', { batchSize, trackLimit });
    Logger.external('Spotify', 'Fetching all tracks for analysis');
    
    // Fetch all tracks (handle pagination if needed)
    let allTracks: any[] = [];
    let offset = 0;
    const limit = 50;
    
    let totalTracks = 0;
    do {
      const tracksResponse = await spotifyApi.getPlaylistTracks(playlistId, { limit, offset });
      const trackItems = tracksResponse.body.items.filter((item: any) => item.track && item.track.type === 'track');
      allTracks = allTracks.concat(trackItems);
      offset += limit;
      totalTracks = tracksResponse.body.total;

      // Break if we've fetched all tracks
      if (tracksResponse.body.items.length < limit) break;
    } while (allTracks.length < totalTracks);
    
    const tracks = allTracks;
    Logger.info('Found valid tracks to analyze', { count: tracks.length, totalPlaylistTracks: playlist.tracks.total });

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

    // Calculate total progress phases: search (70%) + playlist operations (30%)
    const SEARCH_PHASE_WEIGHT = 0.7;
    const PLAYLIST_PHASE_WEIGHT = 0.3;
    
    // Reorder existing YouTube playlist tracks to match current Spotify playlist order
    const reorderExistingTracks = async (
      youtube: any, 
      youtubePlaylistId: string, 
      spotifyTracks: any[], 
      syncedTracks: any[], 
      existingItemsMap: Map<string, any>,
      playlistId: string
    ) => {
      if (syncedTracks.length === 0) {
        Logger.info('No existing synced tracks to reorder');
        return;
      }

      Logger.info('Starting playlist reordering', { 
        syncedTracksCount: syncedTracks.length,
        totalSpotifyTracks: spotifyTracks.length 
      });

      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: 'Reordering existing tracks',
        details: `Organizing ${syncedTracks.length} existing tracks to match Spotify order...`,
        percentage: 15
      });

      // Create a map of Spotify tracks to their current positions
      const spotifyTrackPositions = new Map();
      for (let i = 0; i < spotifyTracks.length; i++) {
        const item = spotifyTracks[i];
        if (item.track && item.track.type === 'track') {
          const track = item.track;
          const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;
          spotifyTrackPositions.set(trackKey, i);
        }
      }

      // Get current YouTube playlist order to compare with target order
      const currentPlaylistItems = await youtube.playlistItems.list({
        part: ['id', 'snippet'],
        playlistId: youtubePlaylistId,
        maxResults: 50
      });
      logApiCall('get current playlist order', 1);
      
      const currentYouTubeOrder = currentPlaylistItems.data.items || [];
      
      // Create a map of current YouTube positions
      const currentPositions = new Map();
      for (let i = 0; i < currentYouTubeOrder.length; i++) {
        const item = currentYouTubeOrder[i];
        if (item.snippet?.resourceId?.videoId) {
          currentPositions.set(item.snippet.resourceId.videoId, {
            currentPosition: i,
            playlistItemId: item.id
          });
        }
      }

      // Find existing YouTube videos that need reordering (only those in wrong positions)
      const reorderOperations = [];
      
      for (const syncedTrack of syncedTracks) {
        if (syncedTrack.track && syncedTrack.track.type === 'track') {
          const track = syncedTrack.track;
          const trackKey = `${track.name.toLowerCase()}-${track.artists[0]?.name?.toLowerCase() || ''}`;
          const targetPosition = spotifyTrackPositions.get(trackKey);
          
          if (targetPosition !== undefined) {
            // Find the corresponding YouTube video
            const spotifyTrackInfo = {
              id: track.id,
              name: track.name,
              artist: track.artists[0]?.name || 'Unknown Artist'
            };
            
            // Get existing videos for matching
            const existingVideos = [];
            for (const item of existingItemsMap.values()) {
              if (item.snippet?.resourceId?.videoId) {
                existingVideos.push({
                  id: item.snippet.resourceId.videoId,
                  title: item.snippet.title || 'Unknown',
                  description: item.snippet.description || '',
                  playlistItemId: item.id
                });
              }
            }
            
            const matchingVideo = findBestMatch(spotifyTrackInfo, existingVideos);
            if (matchingVideo && matchingVideo.playlistItemId) {
              const currentPosInfo = currentPositions.get(matchingVideo.id);
              
              // CRITICAL FIX: Only add to reorder operations if position is actually wrong
              if (currentPosInfo && currentPosInfo.currentPosition !== targetPosition) {
                reorderOperations.push({
                  playlistItemId: matchingVideo.playlistItemId,
                  videoId: matchingVideo.id,
                  currentPosition: currentPosInfo.currentPosition,
                  targetPosition: targetPosition,
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist'
                });
                
                Logger.debug('Track needs repositioning', {
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist',
                  currentPosition: currentPosInfo.currentPosition,
                  targetPosition: targetPosition
                });
              } else {
                Logger.debug('Track already in correct position, skipping', {
                  trackName: track.name,
                  artist: track.artists[0]?.name || 'Unknown Artist',
                  position: targetPosition
                });
              }
            }
          }
        }
      }

      Logger.info('Identified tracks for reordering', { 
        reorderOperationsCount: reorderOperations.length,
        totalSyncedTracks: syncedTracks.length,
        tracksAlreadyInCorrectPosition: syncedTracks.length - reorderOperations.length
      });

      // If no tracks need reordering, skip the entire reordering phase
      if (reorderOperations.length === 0) {
        Logger.info('All tracks already in correct positions - skipping reordering phase');
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: 'Playlist order verified',
          details: `All ${syncedTracks.length} existing tracks are already in correct positions`,
          percentage: 25
        });
        return;
      }

      // Sort reorder operations by target position to maintain order
      reorderOperations.sort((a, b) => a.targetPosition - b.targetPosition);

      // Execute reorder operations
      let reorderedCount = 0;
      for (const operation of reorderOperations) {
        try {
          await youtube.playlistItems.update({
            part: ['snippet'],
            requestBody: {
              id: operation.playlistItemId,
              snippet: {
                playlistId: youtubePlaylistId,
                position: operation.targetPosition,
                resourceId: {
                  kind: 'youtube#video',
                  videoId: operation.videoId,
                }
              }
            }
          });

          reorderedCount++;
          logApiCall('reorder track', 50); // playlistItems.update costs 50 units
          Logger.external('YouTube', 'Reordered track position', { 
            trackName: operation.trackName,
            artist: operation.artist,
            newPosition: operation.targetPosition,
            videoId: operation.videoId
          });

          // Update progress
          const reorderProgress = (reorderedCount / reorderOperations.length) * 0.1; // 10% of total progress for reordering
          const totalPercentage = Math.round((0.15 + reorderProgress) * 100);
          
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: 'Reordering existing tracks',
            details: `Moved "${operation.trackName}" from position ${operation.currentPosition + 1} to ${operation.targetPosition + 1} (${reorderedCount}/${reorderOperations.length})`,
            percentage: totalPercentage
          });

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          Logger.error('Error reordering track', { 
            trackName: operation.trackName,
            targetPosition: operation.targetPosition 
          }, error);
        }
      }

      Logger.info('Playlist reordering complete', { 
        reorderedCount,
        totalOperations: reorderOperations.length 
      });
    };
    
    // Helper function to log API calls with correct quota costs
    const logApiCall = (operation: string, quotaCost: number) => {
      apiCallCount++;
      totalQuotaUsed += quotaCost;
      Logger.external('YouTube', `API call: ${operation}`, { callNumber: apiCallCount, quotaCost, totalQuotaUsed });
    };

    // STEP 1: Check if a YouTube playlist already exists FIRST
    const playlistTitle = `${playlist.name} (from Spotify)`;
    Logger.external('YouTube', 'Checking for existing playlist before video search', { title: playlistTitle });

    let youtubePlaylistId: string = '';
    let existingVideoIds: Set<string> = new Set();
    let existingItemsMap: Map<string, any> = new Map();
    let isUpdateMode = false;
    
    try {
      const existingPlaylists = await youtube.playlists.list({
        part: ['id', 'snippet'],
        mine: true,
        maxResults: 50
      });
      
      logApiCall('playlist search', 1);
      
      if (existingPlaylists.data.items) {
        existingPlaylist = existingPlaylists.data.items.find(p => 
          p.snippet?.title === playlistTitle
        );
      }
      
      if (existingPlaylist) {
        youtubePlaylistId = existingPlaylist.id!;
        isUpdateMode = true;
        Logger.external('YouTube', 'Found existing playlist - entering UPDATE mode', { title: playlistTitle, id: youtubePlaylistId });
        
        // Get existing videos to determine which tracks are already synced
        const existingItems = await youtube.playlistItems.list({
          part: ['id', 'snippet'],
          playlistId: youtubePlaylistId,
          maxResults: 50
        });
        
        logApiCall('get existing items', 1);
        
        const existingVideos = existingItems.data.items || [];
        Logger.info('Found existing videos in playlist', { count: existingVideos.length });
        
        // Map existing videos
        for (const item of existingVideos) {
          if (item.snippet?.resourceId?.videoId) {
            const videoId = item.snippet.resourceId.videoId;
            existingVideoIds.add(videoId);
            existingItemsMap.set(videoId, item);
          }
        }
      } else {
        Logger.info('No existing playlist found - entering CREATE mode');
      }
    } catch (error) {
      Logger.error('Error checking for existing playlist', {}, error);
      // Continue with creation flow
    }
    
    // STEP 2: Determine which tracks need video search based on mode
    let tracksToSearch: any[] = [];
    
    if (isUpdateMode) {
      // UPDATE MODE: Use track matching to identify which tracks are actually unsynced
      const existingVideoCount = existingVideoIds.size;
      
      Logger.info('UPDATE MODE: Using track matching to identify unsynced tracks', {
        totalSpotifyTracks: tracks.length,
        existingYouTubeVideos: existingVideoCount,
        trackLimit
      });
      
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Analyzing playlist for updates`,
        details: `Found ${existingVideoCount} existing videos, matching tracks to identify unsynced ones...`,
        percentage: 5
      });
      
      // Get existing YouTube videos with details for matching
      const existingVideos = [];
      for (const item of existingItemsMap.values()) {
        if (item.snippet?.resourceId?.videoId) {
          const video = {
            id: item.snippet.resourceId.videoId,
            title: item.snippet.title || 'Unknown',
            description: item.snippet.description || ''
          };
          existingVideos.push(video);
          Logger.debug('Existing YouTube video for matching', {
            videoId: video.id,
            title: video.title
          });
        }
      }
      
      Logger.info('Prepared existing videos for matching', {
        existingVideosCount: existingVideos.length,
        existingVideoTitles: existingVideos.map(v => v.title).slice(0, 3) // Show first 3 titles
      });
      
      // Match Spotify tracks to existing YouTube videos to identify unsynced tracks
      const unsyncedTracks = [];
      const syncedTracks = [];
      
      Logger.info('Starting track matching analysis', {
        totalSpotifyTracks: tracks.length,
        existingYouTubeVideos: existingVideos.length
      });
      
      for (const item of tracks) {
        if (item.track && item.track.type === 'track') {
          const track = item.track;
          const spotifyTrack = {
            id: track.id,
            name: track.name,
            artist: track.artists[0]?.name || 'Unknown Artist'
          };
          
          // Use the same matching logic as playlist details
          const matchingVideo = findBestMatch(spotifyTrack, existingVideos);
          
          if (!matchingVideo) {
            unsyncedTracks.push(item);
            Logger.debug('Track identified as UNSYNCED', {
              trackName: spotifyTrack.name,
              artist: spotifyTrack.artist,
              existingVideoCount: existingVideos.length,
              firstFewExistingTitles: existingVideos.slice(0, 3).map(v => v.title)
            });
          } else {
            syncedTracks.push(item);
            Logger.debug('Track identified as SYNCED', {
              trackName: spotifyTrack.name,
              artist: spotifyTrack.artist,
              matchedVideoTitle: matchingVideo.title,
              matchedVideoId: matchingVideo.id
            });
          }
        }
      }
      
      Logger.info('Track matching analysis complete', {
        totalTracks: tracks.length,
        syncedTracks: syncedTracks.length,
        unsyncedTracks: unsyncedTracks.length,
        existingVideos: existingVideos.length
      });
      
      // STEP 2.5: Reorder existing tracks to match current Spotify playlist order
      await reorderExistingTracks(youtube, youtubePlaylistId, tracks, syncedTracks, existingItemsMap, playlistId);
      
      // Limit to trackLimit unsynced tracks per operation
      tracksToSearch = unsyncedTracks.slice(0, trackLimit);
      
      Logger.info('UPDATE MODE: Identified unsynced tracks using matching', {
        totalUnsyncedTracks: unsyncedTracks.length,
        tracksToSearchThisOperation: tracksToSearch.length,
        trackLimit
      });
    } else {
      // CREATE MODE: Process up to trackLimit tracks from the beginning
      Logger.info('CREATE MODE: Processing up to limit tracks from beginning', {
        totalSpotifyTracks: tracks.length,
        trackLimit
      });
      tracksToSearch = tracks.slice(0, trackLimit);
    }
    
    // STEP 3: Search for YouTube videos
    const videoIds: string[] = [];
    const searchResults: Array<{track: string, artist: string, found: boolean, videoId?: string, spotifyPosition: number}> = [];
    let searchCount = 0;
    
    const searchMessage = isUpdateMode ? 'Checking for playlist updates' : 'Finding music videos';
    Logger.info(`Starting video search: ${searchMessage}`, { tracksToSearch: tracksToSearch.length });
    
    for (let i = 0; i < tracksToSearch.length; i++) {
      const item = tracksToSearch[i];
      if (item.track && item.track.type === 'track') {
        const track = item.track;
        const artist = track.artists[0]?.name || 'Unknown Artist';
        const songName = track.name;
        
        // Calculate the original Spotify position
        const spotifyPosition = isUpdateMode ?
          existingVideoIds.size + i : // Update mode: position after existing items
          i; // Create mode: position from beginning
        
        try {
          Logger.debug('Searching for track', { trackNumber: searchCount + 1, totalTracks: tracksToSearch.length, artist, songName });
          
          // Send progress update with current song info (search phase: 0-70% of total)
          const searchProgress = (searchCount / tracksToSearch.length) * SEARCH_PHASE_WEIGHT;
          const totalPercentage = Math.round(searchProgress * 100);
          
          const progressMessage = isUpdateMode ? 'Checking for playlist updates' : 'Finding music videos';
          const progressDetails = isUpdateMode ? 
            `Analyzing "${songName}" by ${artist}... (${searchCount + 1}/${tracksToSearch.length})` :
            `Searching for "${songName}" by ${artist}... (${searchCount + 1}/${tracksToSearch.length})`;
          
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: progressMessage,
            details: progressDetails,
            currentTrack: searchCount + 1,
            totalTracks: tracksToSearch.length,
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
              videoId: videoId,
              spotifyPosition: spotifyPosition
            });
            Logger.info('Found video for track', { songName, artist, videoId, spotifyPosition });
          } else {
            searchResults.push({
              track: songName,
              artist: artist,
              found: false,
              spotifyPosition: spotifyPosition
            });
            Logger.warn('No video found for track', { songName, artist, spotifyPosition });
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
            found: false,
            spotifyPosition: spotifyPosition
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
    
    // STEP 4: Create or update YouTube playlist
    if (isUpdateMode) {
      // UPDATE MODE: Update existing playlist
      Logger.external('YouTube', 'Updating existing playlist', { title: playlistTitle, id: youtubePlaylistId });
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Updating existing playlist: "${playlistTitle}"`,
        details: 'Processing playlist updates...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
    } else {
      // CREATE MODE: Create new playlist
      Logger.external('YouTube', 'Creating new playlist', { title: playlistTitle });
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Creating new YouTube playlist`,
        details: 'Setting up new playlist...',
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
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
      
      // Add all videos to the new playlist in correct order
      // Sort search results by Spotify position to maintain order
      const foundResults = searchResults.filter(result => result.found && result.videoId);
      foundResults.sort((a, b) => a.spotifyPosition - b.spotifyPosition);
      
      for (let i = 0; i < foundResults.length; i++) {
        const result = foundResults[i];
        const videoId = result.videoId!;
        
        try {
          await youtube.playlistItems.insert({
            part: ['snippet'],
            requestBody: {
              snippet: {
                playlistId: youtubePlaylistId,
                position: result.spotifyPosition, // Insert at correct position
                resourceId: {
                  kind: 'youtube#video',
                  videoId: videoId,
                }
              }
            }
          });
          logApiCall('add video to new playlist', 50); // playlistItems.insert costs 50 units
          Logger.external('YouTube', 'Added video to new playlist', { videoId, position: result.spotifyPosition });
          const currentIndex = i + 1;
          // Calculate total progress: 70% (search complete) + 30% * (current/total) for playlist phase
          const playlistProgress = (currentIndex / foundResults.length) * PLAYLIST_PHASE_WEIGHT;
          const totalPercentage = Math.round((SEARCH_PHASE_WEIGHT + playlistProgress) * 100);
          
          // Use the result we already have
          const songName = result.track;
          const artistName = result.artist;
          
          sendProgressUpdate(playlistId, {
            type: 'progress',
            message: `Adding videos to playlist`,
            details: `Adding "${songName}" by ${artistName} (${currentIndex}/${foundResults.length})`,
            currentTrack: currentIndex,
            totalTracks: foundResults.length,
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
      // UPDATE MODE: Add the videos found for next unsynced tracks
      Logger.info('UPDATE MODE: Adding videos for next unsynced tracks');
      
      Logger.info('UPDATE MODE: Video analysis for next tracks', {
        videosFoundForNextTracks: videoIds.length
      });
      
      sendProgressUpdate(playlistId, {
        type: 'progress',
        message: `Adding new tracks to playlist`,
        details: `Adding ${videoIds.length} new videos from next unsynced tracks...`,
        percentage: Math.round(SEARCH_PHASE_WEIGHT * 100)
      });
      
      // Add all videos found (these are only for the next unsynced tracks) in correct order
      const foundResults = searchResults.filter(result => result.found && result.videoId);
      foundResults.sort((a, b) => a.spotifyPosition - b.spotifyPosition);
      
      let addedCount = 0;
      const totalToAdd = foundResults.length;
      
      if (totalToAdd > 0) {
        Logger.info('Adding new videos from next unsynced tracks', { count: totalToAdd });
        
        for (const result of foundResults) {
          const videoId = result.videoId!;
          
          try {
            await youtube.playlistItems.insert({
              part: ['snippet'],
              requestBody: {
                snippet: {
                  playlistId: youtubePlaylistId,
                  position: result.spotifyPosition, // Insert at correct position
                  resourceId: {
                    kind: 'youtube#video',
                    videoId: videoId,
                  }
                }
              }
            });
            logApiCall('add new video', 50); // playlistItems.insert costs 50 units
            addedCount++;
            Logger.external('YouTube', 'Added new video to playlist', { videoId, position: result.spotifyPosition });
            
            // Use the result we already have
            const songName = result.track;
            const artistName = result.artist;
            
            // Update progress
            const playlistProgress = (addedCount / Math.max(totalToAdd, 1)) * PLAYLIST_PHASE_WEIGHT;
            const totalPercentage = Math.round((SEARCH_PHASE_WEIGHT + playlistProgress) * 100);
            
            sendProgressUpdate(playlistId, {
              type: 'progress',
              message: `Adding new tracks`,
              details: `Added "${songName}" by ${artistName} (${addedCount}/${totalToAdd})`,
              currentTrack: addedCount,
              totalTracks: totalToAdd,
              currentSong: songName,
              currentArtist: artistName,
              percentage: totalPercentage
            });
          } catch (error) {
            Logger.error('Error adding new video to playlist', { videoId }, error);
            sendProgressUpdate(playlistId, {
              type: 'error',
              message: 'Error adding video to playlist',
              details: error instanceof Error ? error.message : 'An unexpected error occurred'
            });
          }
        }
      }
      
      // Step 3: Reorder playlist to match Spotify order (if we added any videos)
      if (totalToAdd > 0) {
        Logger.info('Reordering playlist to match Spotify order');
        
        sendProgressUpdate(playlistId, {
          type: 'progress',
          message: `Finalizing playlist order`,
          details: 'Ensuring track order matches Spotify...',
          percentage: 95
        });
        
        // Get the updated playlist items to reorder
        const updatedItems = await youtube.playlistItems.list({
          part: ['id', 'snippet'],
          playlistId: youtubePlaylistId,
          maxResults: 50
        });
        
        logApiCall('get updated items for reorder', 1);
        
        const currentItems = updatedItems.data.items || [];
        const currentOrder = currentItems.map(item => item.snippet?.resourceId?.videoId).filter(Boolean);
        
        // For update mode, we don't reorder since we're only adding new videos at the end
        // The existing videos maintain their original order from the previous sync
        Logger.info('Update mode: New videos added at end, preserving existing order');
      } else {
        Logger.info('No changes needed - playlist is already in sync');
      }
      
      Logger.info('Update completed', {
        videosAdded: addedCount,
        totalVideosToAdd: totalToAdd
      });
    }
    
    Logger.requestEnd('Sync Request Completed', Date.now() - startTime);
    
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
    
    // Generate user-friendly sync feedback with unlinked track details
    const videosFound = searchResults.filter(r => r.found).length;
    const videosNotFound = searchResults.filter(r => !r.found).length;
    const unlinkedTracks = searchResults.filter(r => !r.found);
    
    let syncFeedbackHtml = `
      <div class="sync-feedback alert alert-success alert-dismissible fade show" data-playlist-id="${playlistId}">
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        <div><strong>Playlist ${existingPlaylist ? 'updated' : 'created'} successfully!</strong></div>
        <div class="small">Found ${videosFound} out of ${searchResults.length} tracks${tracks.length > trackLimit ? ` (limited from ${tracks.length} total)` : ''}</div>`;
    
    // Add unlinked tracks information if any
    if (videosNotFound > 0) {
      syncFeedbackHtml += `
        <div class="mt-2">
          <div class="small text-warning">
            <strong>${videosNotFound} track${videosNotFound > 1 ? 's' : ''} could not be linked:</strong>
          </div>
          <div class="small text-muted mt-1">`;
      
      unlinkedTracks.forEach((track, index) => {
        syncFeedbackHtml += `${track.track} by ${track.artist}`;
        if (index < unlinkedTracks.length - 1) {
          syncFeedbackHtml += ', ';
        }
      });
      
      syncFeedbackHtml += `
          </div>
          <div class="small text-muted mt-1">
            <em>These tracks will appear as unlinked in the playlist details view.</em>
          </div>
        </div>`;
    }
    
    syncFeedbackHtml += `
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
      totalQuotaUsed: totalQuotaUsed,
      operationAttempted: existingPlaylist ? 'UPDATE' : 'SYNC'
    });
    
    // Check if it's a quota exceeded error
    if (error && typeof error === 'object' && 'code' in error && error.code === 403) {
      const gaxiosError = error as any;
      if (gaxiosError.errors && gaxiosError.errors.some((e: any) => e.reason === 'quotaExceeded')) {
        Logger.warn('YouTube API quota exceeded - sync stopped gracefully');
        return res.status(429).send(`
          <div class="alert alert-warning">
            <h5>YouTube API Quota Exceeded</h5>
            <p>You've reached the daily YouTube API quota limit. The sync was stopped to prevent further errors.</p>
            <p>Please try again tomorrow when the quota resets, or consider reducing the number of tracks processed per sync.</p>
            <p>Some tracks may have been successfully added before hitting the quota limit.</p>
          </div>
        `);
      }
    }
    
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
