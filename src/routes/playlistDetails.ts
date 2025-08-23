import { Router } from 'express';
import { google } from 'googleapis';
import { scrapeYouTubeSearch } from '../utils/youtubeScraper';
import { Logger } from '../utils/logger';
const SpotifyWebApi = require('spotify-web-api-node');

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
router.get('/playlist/:playlistId', async (req, res) => {
  const startTime = Date.now();
  const { playlistId } = req.params;
  
  Logger.requestStart('Playlist Details Request', {
    sessionId: req.sessionID,
    playlistId
  });

  try {
    // Check authentication
    if (!req.session.spotifyTokens || !req.session.youtubeTokens) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Both Spotify and YouTube authentication required'
      });
    }

    // Initialize Spotify API
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);

    // Initialize YouTube API
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(req.session.youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Get Spotify playlist tracks
    Logger.external('Spotify', 'Fetching playlist tracks', { playlistId });
    const spotifyPlaylistData = await spotifyApi.getPlaylist(playlistId);
    const spotifyTracks = spotifyPlaylistData.body.tracks.items.map((item: any) => ({
      id: item.track.id,
      name: item.track.name,
      artist: item.track.artists[0]?.name || 'Unknown Artist',
      album: item.track.album?.name || 'Unknown Album',
      duration_ms: item.track.duration_ms,
      external_urls: item.track.external_urls,
      preview_url: item.track.preview_url
    }));

    Logger.info('Found Spotify tracks', { count: spotifyTracks.length });

    // Find corresponding YouTube playlist
    const youtubePlaylistTitle = `${spotifyPlaylistData.body.name} (from Spotify)`;
    Logger.external('YouTube', 'Looking for playlist', { title: youtubePlaylistTitle });
    
    const youtubePlaylistsResponse = await youtube.playlists.list({
      part: ['snippet'],
      mine: true,
      maxResults: 50
    });

    const youtubePlaylist = youtubePlaylistsResponse.data.items?.find(
      playlist => playlist.snippet?.title === youtubePlaylistTitle
    );

    let youtubeVideos: any[] = [];
    
    if (youtubePlaylist) {
      Logger.external('YouTube', 'Found matching playlist', { playlistId: youtubePlaylist.id });
      
      // Get YouTube playlist videos
      const youtubeVideosResponse = await youtube.playlistItems.list({
        part: ['snippet', 'contentDetails'],
        playlistId: youtubePlaylist.id!,
        maxResults: 50
      });

      youtubeVideos = youtubeVideosResponse.data.items?.map((item: any) => ({
        id: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        description: item.snippet.description || '',
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        publishedAt: item.snippet.publishedAt,
        url: `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`
      })) || [];

      Logger.info('Found YouTube videos', { count: youtubeVideos.length });
    } else {
      Logger.info('No corresponding YouTube playlist found');
    }

    // Create merged view of tracks with their YouTube counterparts using improved matching
    const mergedTracks = spotifyTracks.map((track: any) => {
      // Find matching YouTube video using flexible matching algorithm
      const matchingVideo = findBestMatch(track, youtubeVideos);
      
      return {
        spotify: track,
        youtube: matchingVideo || null,
        linked: !!matchingVideo
      };
    });

    // Helper function for flexible track matching
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
    
    // Calculate similarity score between Spotify track and YouTube video
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
    
    // Extract core title by removing metadata, remaster info, live info, etc.
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
    
    // Normalize text for better matching
    function normalizeText(text: string): string {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .replace(/\b(official|video|audio|live|remix|version|ft|feat|featuring)\b/g, '') // Remove common extra words
        .trim();
    }
    
    // Simple string similarity using Jaro-Winkler-like algorithm
    function calculateStringSimilarity(str1: string, str2: string): number {
      if (str1 === str2) return 1.0;
      
      const longer = str1.length > str2.length ? str1 : str2;
      const shorter = str1.length > str2.length ? str2 : str1;
      
      if (longer.length === 0) return 1.0;
      
      const editDistance = calculateLevenshteinDistance(longer, shorter);
      return (longer.length - editDistance) / longer.length;
    }
    
    // Calculate Levenshtein distance between two strings
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

    // Only include YouTube videos that weren't matched to any Spotify tracks
    const matchedVideoIds = mergedTracks
      .filter(track => track.youtube)
      .map(track => track.youtube.id);
      
    const unmatchedYoutubeVideos = youtubeVideos.filter((video: any) => 
      !matchedVideoIds.includes(video.id)
    );

    const orphanedVideos = unmatchedYoutubeVideos.map((video: any) => ({
      spotify: null,
      youtube: video,
      linked: false
    }));

    const allTracks = [...mergedTracks, ...orphanedVideos];

    Logger.info('Track matching results', {
      matchedTracks: mergedTracks.filter(t => t.linked).length,
      spotifyOnlyTracks: mergedTracks.filter(t => !t.linked).length,
      youtubeOnlyVideos: orphanedVideos.length
    });

    // Generate HTML response
    const playlistDetailsHtml = `
      <div class="playlist-details" data-playlist-id="${playlistId}">
        <div class="playlist-header mb-3">
          <h6>${spotifyPlaylistData.body.name}</h6>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted small">
              ${allTracks.length} tracks • ${mergedTracks.filter(t => t.linked).length} linked
            </span>
            <button type="button" class="btn btn-outline-secondary btn-sm" 
                    onclick="refreshPlaylistDetails('${playlistId}')"
                    title="Refresh playlist details">
              Refresh
            </button>
          </div>
        </div>
        
        <div id="details-${playlistId}" class="tracks-list">
          ${allTracks.map((track, index) => `
            <div class="track-item d-flex align-items-center py-2 ${index % 2 === 0 ? 'bg-light' : ''}" style="border-radius: 4px;">
              <div class="track-number me-3 text-muted small" style="min-width: 30px;">
                ${index + 1}
              </div>
              
              <div class="track-content flex-grow-1">
                ${track.spotify ? `
                  <div class="spotify-track">
                    <div class="track-title fw-semibold">${track.spotify.name}</div>
                    <div class="track-artist text-muted small">${track.spotify.artist} • ${track.spotify.album}</div>
                  </div>
                ` : ''}
                
                ${track.youtube ? `
                  <div class="youtube-video ${track.spotify ? 'mt-1' : ''}">
                    <div class="d-flex align-items-center">
                      <img src="${track.youtube.thumbnail}" alt="Video thumbnail" 
                           style="width: 40px; height: 30px; object-fit: cover; border-radius: 3px;" class="me-2">
                      <div class="flex-grow-1">
                        <a href="${track.youtube.url}" target="_blank" class="text-decoration-none small">
                          ${track.youtube.title}
                        </a>
                      </div>
                    </div>
                  </div>
                ` : ''}
              </div>
              
              <div class="track-status ms-2 d-flex align-items-center gap-2">
                ${track.linked ? 
                  `<span class="badge bg-success">Linked</span>
                   <button type="button" class="btn btn-outline-secondary btn-sm" 
                           onclick="editTrackVideo('${playlistId}', '${track.spotify.id}', '${track.spotify.name.replace(/'/g, "\\'")}', '${track.spotify.artist.replace(/'/g, "\\'")}', '${track.youtube?.id || ''}')"
                           title="Edit linked video">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                       <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                     </svg>
                   </button>` : 
                  track.spotify ? 
                    '<span class="badge bg-warning">Spotify Only</span>' : 
                    '<span class="badge bg-info">YouTube Only</span>'
                }
              </div>
            </div>
          `).join('')}
        </div>
        
        <!-- Collapse area at bottom of expanded details -->
        <div class="playlist-collapse-area" 
             data-playlist-id="${playlistId}"
             onclick="
               const expandArea = document.querySelector('.playlist-expand-area[data-playlist-id=&quot;${playlistId}&quot;]');
               if (expandArea) {
                 expandArea.click();
                 setTimeout(() => {
                   expandArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
                 }, 100);
               }
             "
             style="position: relative; cursor: pointer; user-select: none; display: flex; align-items: center; justify-content: center; height: 50px; margin: 0; margin-bottom: -15px; padding-bottom: 15px;">
          <span class="collapse-indicator" style="font-size: 16px; color: #ff0040; padding: 8px 90px; border-radius: 3px; transition: all 0.2s;">▲</span>
        </div>
      </div>
    `;

    const duration = Date.now() - startTime;
    Logger.requestEnd('Playlist Details Request', duration, { playlistId });
    res.send(playlistDetailsHtml);

  } catch (error) {
    const duration = Date.now() - startTime;
    Logger.error('Error fetching playlist details', { playlistId, duration }, error);
    
    res.status(500).send(`
      <div class="alert alert-danger">
        <h6>Error loading playlist details</h6>
        <p>Unable to fetch playlist information. Please try again.</p>
        <small class="text-muted">Error: ${error instanceof Error ? error.message : 'Unknown error'}</small>
      </div>
    `);
  }
});

// Search for alternative YouTube videos for a track
router.get('/search/:trackId', async (req, res) => {
  const { trackId } = req.params;
  const { trackName, artistName } = req.query;
  
  Logger.requestStart('Track Video Search Request', {
    trackId,
    trackName,
    artistName
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

    // Generate HTML response with video selection interface
    const videoSelectionHtml = `
      <div class="video-selection-modal" data-track-id="${trackId}">
        <div class="modal-header mb-3">
          <h5>Select Alternative Video</h5>
          <p class="text-muted mb-0">Choose a different YouTube video for: <strong>${trackName}</strong> by <strong>${artistName}</strong></p>
        </div>
        
        <div class="video-options" style="max-height: 400px; overflow-y: auto;">
          ${videos.map((video, index) => `
            <div class="video-option p-3 border rounded mb-2" 
                 data-video-id="${video.id}"
                 style="cursor: pointer; transition: all 0.2s;"
                 onclick="selectVideo('${video.id}', this)">
              <div class="d-flex align-items-start">
                <img src="${video.thumbnail}" alt="Video thumbnail" 
                     style="width: 120px; height: 90px; object-fit: cover; border-radius: 4px;" class="me-3">
                <div class="flex-grow-1">
                  <h6 class="mb-1">${video.title}</h6>
                  <p class="text-muted small mb-1">by ${video.channelTitle}</p>
                  <p class="small mb-0" style="max-height: 60px; overflow: hidden;">
                    ${video.description.substring(0, 150)}${video.description.length > 150 ? '...' : ''}
                  </p>
                </div>
                <div class="selection-indicator ms-2" style="display: none;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#28a745">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
        
        <div class="modal-footer mt-3 d-flex justify-content-between">
          <button type="button" class="btn btn-secondary" onclick="cancelVideoSelection()">
            Cancel
          </button>
          <button type="button" class="btn btn-primary" id="confirm-selection-btn" 
                  onclick="confirmVideoSelection('${trackId}')" disabled>
            Confirm Selection
          </button>
        </div>
      </div>
    `;

    res.send(videoSelectionHtml);

  } catch (error) {
    Logger.error('Error searching for alternative videos', { trackId, trackName, artistName }, error);
    
    res.status(500).send(`
      <div class="alert alert-danger">
        <h6>Error searching for videos</h6>
        <p>Unable to search for alternative videos. Please try again.</p>
        <small class="text-muted">Error: ${error instanceof Error ? error.message : 'Unknown error'}</small>
      </div>
    `);
  }
});

// Replace a video in a YouTube playlist
router.post('/replace/:trackId', async (req, res) => {
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
    if (!req.session.youtubeTokens) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'YouTube authentication required'
      });
    }

    // Initialize YouTube API
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(req.session.youtubeTokens);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // We need to find the YouTube playlist that corresponds to this Spotify playlist
    // First, get the Spotify playlist name to construct the YouTube playlist name
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(req.session.spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(req.session.spotifyTokens.refreshToken);
    
    const spotifyPlaylistData = await spotifyApi.getPlaylist(playlistId);
    const expectedYouTubePlaylistName = `${spotifyPlaylistData.body.name} (from Spotify)`;
    
    Logger.external('YouTube', 'Looking for playlist', { name: expectedYouTubePlaylistName });

    // Get all user's YouTube playlists to find the matching one
    const playlistsResponse = await youtube.playlists.list({
      part: ['snippet'],
      mine: true,
      maxResults: 50
    });

    const targetPlaylist = playlistsResponse.data.items?.find(playlist => 
      playlist.snippet?.title === expectedYouTubePlaylistName
    );

    if (!targetPlaylist) {
      Logger.error('YouTube playlist not found', { name: expectedYouTubePlaylistName });
      return res.status(404).json({
        error: 'Playlist not found',
        message: `Could not find YouTube playlist: "${expectedYouTubePlaylistName}"`
      });
    }

    Logger.external('YouTube', 'Found target playlist', { title: targetPlaylist.snippet?.title, id: targetPlaylist.id });

    // Get playlist items to find the current video
    const playlistItemsResponse = await youtube.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId: targetPlaylist.id!,
      maxResults: 50
    });

    // Look for the current video in this playlist
    const playlistItemToReplace = playlistItemsResponse.data.items?.find(item => 
      item.snippet?.resourceId?.videoId === currentVideoId
    );

    if (!playlistItemToReplace) {
      Logger.error('Video not found in playlist', { currentVideoId, playlistTitle: targetPlaylist.snippet?.title });
      return res.status(404).json({
        error: 'Video not found',
        message: `Could not find video ${currentVideoId} in the YouTube playlist`
      });
    }

    Logger.info('Starting video replacement', { currentVideoId, newVideoId, playlistTitle: targetPlaylist.snippet?.title });

    // Get the position of the current video so we can maintain order
    const currentPosition = playlistItemToReplace.snippet?.position || 0;

    // Add the new video at the same position
    const insertResponse = await youtube.playlistItems.insert({
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
    Logger.info('Video replacement completed successfully');

    res.json({
      success: true,
      message: 'Video replaced successfully',
      oldVideoId: currentVideoId,
      newVideoId: newVideoId,
      playlistId: targetPlaylist.id
    });

  } catch (error) {
    Logger.error('Error replacing video', { trackId, currentVideoId, newVideoId }, error);
    
    res.status(500).json({
      error: 'Video replacement failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

export { router as playlistDetailsRouter };
