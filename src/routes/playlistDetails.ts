import { Router } from 'express';
import { google } from 'googleapis';
import { scrapeYouTubeSearch } from '../utils/youtubeScraper';
import { Logger } from '../utils/logger';
import ejs from 'ejs';
import path from 'path';
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
    playlistId
  });

  try {
    // Check authentication
    const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
    const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;

    if (!spotifyTokens || !youtubeTokens) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Both Spotify and YouTube authentication required'
      });
    }

    // Initialize Spotify API
    const spotifyApi = getSpotifyApi();
    spotifyApi.setAccessToken(spotifyTokens.accessToken);
    spotifyApi.setRefreshToken(spotifyTokens.refreshToken);

    // Initialize YouTube API
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials(youtubeTokens);
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
      .filter((track: any) => track.youtube)
      .map((track: any) => track.youtube.id);

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
      matchedTracks: mergedTracks.filter((t: any) => t.linked).length,
      spotifyOnlyTracks: mergedTracks.filter((t: any) => !t.linked).length,
      youtubeOnlyVideos: orphanedVideos.length
    });

    // Generate HTML response
    const playlistDetailsHtml = `
      <div class="playlist-details" data-playlist-id="${playlistId}">
        <div class="playlist-header mb-3">
          <h6>${spotifyPlaylistData.body.name}</h6>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted small">
              ${allTracks.length} tracks • ${mergedTracks.filter((t: any) => t.linked).length} linked
            </span>
            <button type="button" class="btn btn-outline-secondary btn-sm"
                    data-refresh-playlist="${playlistId}"
                    hx-get="/api/playlistDetails/playlist/${playlistId}"
                    hx-target="#details-${playlistId}"
                    hx-swap="outerHTML"
                    hx-headers='{"Cache-Control": "no-cache"}'
                    title="Refresh playlist details">
              Refresh
            </button>
          </div>
        </div>
        
        <div id="details-${playlistId}" class="tracks-list">
          ${allTracks.map((track, index) => `
            <div class="track-item ${index % 2 === 0 ? 'track-item--even' : ''}">
              <div class="track-number">
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
                           class="youtube-video__thumbnail">
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
                           hx-get="/api/playlistDetails/search/${track.spotify.id}?trackName=${encodeURIComponent(track.spotify.name)}&artistName=${encodeURIComponent(track.spotify.artist)}&playlistId=${playlistId}&currentVideoId=${track.youtube?.id || ''}"
                           hx-target="#video-modal-content"
                           hx-swap="innerHTML"
                           title="Edit linked video">
                     <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                       <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                     </svg>
                   </button>` :
                  track.spotify ?
                    `<span class="badge bg-warning">Unlinked</span>
                     <button type="button" class="btn btn-outline-secondary btn-sm"
                             hx-get="/api/playlistDetails/search/${track.spotify.id}?trackName=${encodeURIComponent(track.spotify.name)}&artistName=${encodeURIComponent(track.spotify.artist)}&playlistId=${playlistId}&currentVideoId="
                             hx-target="#video-modal-content"
                             hx-swap="innerHTML"
                             title="Link video to this track">
                       <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                         <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                       </svg>
                     </button>` :
                    '<span class="badge bg-info">YouTube Only</span>'
                }
              </div>
            </div>
          `).join('')}
        </div>
        
        <!-- Collapse area at bottom of expanded details -->
        <div class="playlist-collapse-area"
             data-playlist-id="${playlistId}"
             _="on click
                  get the first .playlist-expand-area[@data-playlist-id='${playlistId}'] then
                  trigger click on it then
                  wait 100ms then
                  call it.scrollIntoView({behavior: 'smooth', block: 'center'})"
">
          <span class="collapse-indicator">▲</span>
        </div>
      </div>
    `;

    const duration = Date.now() - startTime;
    Logger.requestEnd('Playlist Details Request', duration, { playlistId });

    // Cache for 10 minutes to save YouTube API quota
    res.set('Cache-Control', 'private, max-age=600');
    res.send(playlistDetailsHtml);

  } catch (error) {
    const duration = Date.now() - startTime;
    Logger.error('Error fetching playlist details', { playlistId, duration }, error);
    
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'danger',
      title: 'Error loading playlist details',
      message: 'Unable to fetch playlist information. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).send(html);
  }
});

// Search for alternative YouTube videos for a track
router.get('/search/:trackId', async (req, res) => {
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

    // Generate HTML response with video selection interface
    const videoSelectionHtml = `
      <div class="modal-header">
        <h5 class="modal-title">Select Alternative Video</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <p class="text-muted mb-3">Choose a different YouTube video for: <strong>${trackName}</strong> by <strong>${artistName}</strong></p>

        <div class="video-options">
          ${videos.map((video, index) => `
            <div class="video-option p-3 border rounded mb-2"
                 data-video-id="${video.id}"
                 _="on click
                      -- Deselect all other options
                      for opt in <.video-option/>
                        remove .selected from opt
                        set opt.style.backgroundColor to ''
                        set opt.style.borderColor to ''
                        set the *display of the first .selection-indicator in opt to 'none'
                      end
                      -- Select this option
                      add .selected to me
                      set my style.backgroundColor to '#e8f5e8'
                      set my style.borderColor to '#28a745'
                      set the *display of the first .selection-indicator in me to 'block'
                      -- Enable confirm button and store selected video ID
                      set #confirm-selection-btn.disabled to false
                      set @data-selected-video-id of #confirm-selection-btn to '${video.id}'">
              <div class="d-flex align-items-start">
                <img src="${video.thumbnail}" alt="Video thumbnail"
                     class="video-option__thumbnail me-3">
                <div class="flex-grow-1">
                  <h6 class="mb-1">${video.title}</h6>
                  <p class="text-muted small mb-1">by ${video.channelTitle}</p>
                  <p class="small mb-0 video-option__description--truncated">
                    ${video.description.substring(0, 150)}${video.description.length > 150 ? '...' : ''}
                  </p>
                </div>
                <div class="selection-indicator selection-indicator--hidden ms-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#28a745">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
          Cancel
        </button>
        <button type="button" class="btn btn-primary" id="confirm-selection-btn"
                data-track-id="${trackId}"
                data-playlist-id="${playlistId}"
                data-current-video-id="${currentVideoId || ''}"
                hx-post="/api/playlistDetails/replace/${trackId}"
                hx-vals='js:{newVideoId: document.getElementById("confirm-selection-btn").getAttribute("data-selected-video-id"), currentVideoId: document.getElementById("confirm-selection-btn").getAttribute("data-current-video-id"), playlistId: document.getElementById("confirm-selection-btn").getAttribute("data-playlist-id")}'
                hx-swap="none"
                _="on htmx:afterRequest
                     if event.detail.successful
                       js
                         const modal = bootstrap.Modal.getInstance(document.getElementById('videoSelectionModal'));
                         if (modal) modal.hide();
                         setTimeout(() => {
                           const refreshBtn = document.querySelector('[data-refresh-playlist=&quot;${playlistId}&quot;]');
                           if (refreshBtn) refreshBtn.click();
                         }, 300);
                       end
                     end"
                disabled>
          Confirm Selection
        </button>
      </div>
    `;

    res.send(videoSelectionHtml);

  } catch (error) {
    Logger.error('Error searching for alternative videos', { trackId, trackName, artistName }, error);
    
    const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
      type: 'danger',
      title: 'Error searching for videos',
      message: 'Unable to search for alternative videos. Please try again.',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
    res.status(500).send(html);
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
    const youtubeTokens = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;
    const spotifyTokens = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;

    if (!youtubeTokens) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'YouTube authentication required'
      });
    }

    if (!spotifyTokens) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Spotify authentication required'
      });
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
