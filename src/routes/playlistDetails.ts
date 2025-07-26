import { Router } from 'express';
import { google } from 'googleapis';
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
  
  console.log('\n🔍 === PLAYLIST DETAILS REQUEST ===');
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`👤 Session ID: ${req.sessionID}`);
  console.log(`🎵 Playlist ID: ${playlistId}`);

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
    console.log('📻 Fetching Spotify playlist tracks...');
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

    console.log(`📻 Found ${spotifyTracks.length} Spotify tracks`);

    // Find corresponding YouTube playlist
    const youtubePlaylistTitle = `${spotifyPlaylistData.body.name} (from Spotify)`;
    console.log(`📺 Looking for YouTube playlist: "${youtubePlaylistTitle}"`);
    
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
      console.log(`📺 Found YouTube playlist: ${youtubePlaylist.id}`);
      
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

      console.log(`📺 Found ${youtubeVideos.length} YouTube videos`);
    } else {
      console.log('📺 No corresponding YouTube playlist found');
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

    console.log(`🔗 Matched tracks: ${mergedTracks.filter(t => t.linked).length}`);
    console.log(`📻 Spotify-only tracks: ${mergedTracks.filter(t => !t.linked).length}`);
    console.log(`📺 YouTube-only videos: ${orphanedVideos.length}`);

    // Generate HTML response
    const playlistDetailsHtml = `
      <div class="playlist-details" data-playlist-id="${playlistId}">
        <div class="playlist-header mb-3">
          <h6>${spotifyPlaylistData.body.name}</h6>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted small">
              ${allTracks.length} tracks • ${mergedTracks.filter(t => t.linked).length} linked
            </span>
            <button class="btn btn-outline-secondary btn-sm" 
                    hx-get="/api/playlistDetails/playlist/${playlistId}"
                    hx-target="[data-playlist-id='${playlistId}']"
                    hx-swap="outerHTML"
                    title="Refresh playlist details">
              Refresh
            </button>
          </div>
        </div>
        
        <div class="tracks-list">
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
              
              <div class="track-status ms-2">
                ${track.linked ? 
                  '<span class="badge bg-success">Linked</span>' : 
                  track.spotify ? 
                    '<span class="badge bg-warning">Spotify Only</span>' : 
                    '<span class="badge bg-info">YouTube Only</span>'
                }
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    console.log(`🕒 Request processing time: ${Date.now() - startTime}ms`);
    res.send(playlistDetailsHtml);

  } catch (error) {
    console.error('Error fetching playlist details:', error);
    console.log(`🕒 Request processing time: ${Date.now() - startTime}ms`);
    
    res.status(500).send(`
      <div class="alert alert-danger">
        <h6>Error loading playlist details</h6>
        <p>Unable to fetch playlist information. Please try again.</p>
        <small class="text-muted">Error: ${error instanceof Error ? error.message : 'Unknown error'}</small>
      </div>
    `);
  }
});

export { router as playlistDetailsRouter };
