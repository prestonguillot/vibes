import { Router } from 'express';
import { google } from 'googleapis';
import { scrapeYouTubeSearch } from '../utils/youtubeScraper';
import { Logger } from '../utils/logger';
import { validate, schemas, ValidatedRequest } from '../utils/validation';
import { csrfValidationMiddleware } from '../utils/csrf';
import { SpotifyTokens, YouTubeTokens } from '../types/oauth';
import { CacheDuration, setCache } from '../utils/cache';
import { youtube_v3 } from 'googleapis';
import { z } from 'zod';
import ejs from 'ejs';
import path from 'path';
const SpotifyWebApi = require('spotify-web-api-node');

// Internal types for this route
interface SimplifiedTrack {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration_ms: number;
  external_urls: { spotify: string };
  preview_url: string | null;
}

interface SimplifiedVideo {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
  url: string;
  channelTitle?: string;
}

interface MergedTrack {
  spotify: SimplifiedTrack | null;
  youtube: SimplifiedVideo | null;
  linked: boolean;
}

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
    // Check authentication
    const spotifyTokens: SpotifyTokens | null = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;
    const youtubeTokens: YouTubeTokens | null = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;

    if (!spotifyTokens || !youtubeTokens) {
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'Authentication Required',
        message: 'Please connect to both Spotify and YouTube first',
        details: 'Use the connection buttons at the top of the page to authenticate with both services.'
      });
      return res.status(401).send(html);
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

    // Filter out null/deleted tracks and map to our format
    const spotifyTracks: SimplifiedTrack[] = spotifyPlaylistData.body.tracks.items
      .filter((item: unknown) => {
        const typedItem = item as { track: unknown | null };
        return typedItem.track !== null;
      }) // Skip deleted/unavailable tracks
      .map((item: unknown): SimplifiedTrack => {
        const typedItem = item as { track: { id: string; name: string; artists: Array<{ name?: string }>; album?: { name?: string }; duration_ms: number; external_urls: { spotify: string }; preview_url?: string | null } };
        return {
          id: typedItem.track.id,
          name: typedItem.track.name,
          artist: typedItem.track.artists[0]?.name || 'Unknown Artist',
          album: typedItem.track.album?.name || 'Unknown Album',
          duration_ms: typedItem.track.duration_ms,
          external_urls: typedItem.track.external_urls,
          preview_url: typedItem.track.preview_url || null
        };
      });

    const totalTracksInPlaylist = spotifyPlaylistData.body.tracks.items.length;
    const nullTracksCount = totalTracksInPlaylist - spotifyTracks.length;

    if (nullTracksCount > 0) {
      Logger.warn('Playlist contains unavailable tracks', {
        playlistId,
        totalTracks: totalTracksInPlaylist,
        availableTracks: spotifyTracks.length,
        unavailableTracks: nullTracksCount
      });
    }

    Logger.info('Found Spotify tracks', { count: spotifyTracks.length });

    // Find corresponding YouTube playlist (with pagination to handle >50 playlists)
    const youtubePlaylistTitle = `${spotifyPlaylistData.body.name} (from Spotify)`;
    Logger.external('YouTube', 'Looking for playlist', { title: youtubePlaylistTitle });

    let youtubePlaylist: youtube_v3.Schema$Playlist | undefined = undefined;
    let nextPageToken: string | undefined = undefined;

    do {
      const youtubePlaylistsResponse: youtube_v3.Schema$PlaylistListResponse = await youtube.playlists.list({
        part: ['snippet'],
        mine: true,
        maxResults: 50,
        pageToken: nextPageToken
      }).then(res => res.data);

      youtubePlaylist = youtubePlaylistsResponse.items?.find(
        (playlist: youtube_v3.Schema$Playlist) => playlist.snippet?.title === youtubePlaylistTitle
      );

      // If we found it, break early
      if (youtubePlaylist) break;

      nextPageToken = youtubePlaylistsResponse.nextPageToken || undefined;
    } while (nextPageToken);

    let youtubeVideos: SimplifiedVideo[] = [];

    if (youtubePlaylist) {
      Logger.external('YouTube', 'Found matching playlist', { playlistId: youtubePlaylist.id });

      // Get ALL YouTube playlist videos (with pagination to handle >50 videos)
      const allPlaylistItems: youtube_v3.Schema$PlaylistItem[] = [];
      let nextPageToken: string | undefined = undefined;

      do {
        const youtubeVideosResponse: youtube_v3.Schema$PlaylistItemListResponse = await youtube.playlistItems.list({
          part: ['snippet', 'contentDetails'],
          playlistId: youtubePlaylist.id!,
          maxResults: 50,
          pageToken: nextPageToken
        }).then(res => res.data);

        if (youtubeVideosResponse.items) {
          allPlaylistItems.push(...youtubeVideosResponse.items);
        }

        nextPageToken = youtubeVideosResponse.nextPageToken || undefined;
      } while (nextPageToken);

      youtubeVideos = allPlaylistItems.map((item: youtube_v3.Schema$PlaylistItem): SimplifiedVideo => ({
        id: item.snippet?.resourceId?.videoId || '',
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
        publishedAt: item.snippet?.publishedAt || '',
        url: `https://www.youtube.com/watch?v=${item.snippet?.resourceId?.videoId || ''}`
      }));

      Logger.info('Found YouTube videos', { count: youtubeVideos.length });
    } else {
      Logger.info('No corresponding YouTube playlist found');
    }

    // Create merged view of tracks with their YouTube counterparts using improved matching
    const mergedTracks: MergedTrack[] = spotifyTracks.map((track: SimplifiedTrack): MergedTrack => {
      // Find matching YouTube video using flexible matching algorithm
      const matchingVideo = findBestMatch(track, youtubeVideos);

      return {
        spotify: track,
        youtube: matchingVideo || null,
        linked: !!matchingVideo
      };
    });

    // Helper function for flexible track matching
    function findBestMatch(spotifyTrack: SimplifiedTrack, youtubeVideos: SimplifiedVideo[]): SimplifiedVideo | null {
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
    function calculateMatchScore(spotifyTrack: SimplifiedTrack, youtubeVideo: SimplifiedVideo): number {
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
      .filter((track: MergedTrack) => track.youtube)
      .map((track: MergedTrack) => track.youtube!.id);

    const unmatchedYoutubeVideos = youtubeVideos.filter((video: SimplifiedVideo) =>
      !matchedVideoIds.includes(video.id)
    );

    const orphanedVideos: MergedTrack[] = unmatchedYoutubeVideos.map((video: SimplifiedVideo): MergedTrack => ({
      spotify: null,
      youtube: video,
      linked: false
    }));

    const allTracks: MergedTrack[] = [...mergedTracks, ...orphanedVideos];

    Logger.info('Track matching results', {
      matchedTracks: mergedTracks.filter((t: MergedTrack) => t.linked).length,
      spotifyOnlyTracks: mergedTracks.filter((t: MergedTrack) => !t.linked).length,
      youtubeOnlyVideos: orphanedVideos.length
    });

    // Generate HTML response
    const playlistDetailsHtml = `
      <div class="playlist-details" data-playlist-id="${playlistId}">
        <div class="playlist-header mb-3">
          <h6>${spotifyPlaylistData.body.name}</h6>
          <div class="d-flex justify-content-between align-items-center">
            <span class="text-muted small">
              ${allTracks.length} tracks • ${mergedTracks.filter((t: MergedTrack) => t.linked).length} linked
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
                           hx-get="/api/playlistDetails/search/${track.spotify!.id}?trackName=${encodeURIComponent(track.spotify!.name)}&artistName=${encodeURIComponent(track.spotify!.artist)}&playlistId=${playlistId}&currentVideoId=${track.youtube?.id || ''}"
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
                             hx-get="/api/playlistDetails/search/${track.spotify!.id}?trackName=${encodeURIComponent(track.spotify!.name)}&artistName=${encodeURIComponent(track.spotify!.artist)}&playlistId=${playlistId}&currentVideoId="
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
        <label for="expand-${playlistId}" class="playlist-collapse-area" data-playlist-id="${playlistId}">
          <span class="collapse-indicator">▲</span>
        </label>
      </div>
    `;

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

    if (errorCode === 403 || errorMessage.toLowerCase().includes('quota')) {
      const html = await ejs.renderFile(path.join(__dirname, '../../views/partials/error-message.ejs'), {
        type: 'warning',
        title: 'YouTube API Quota Exceeded',
        message: 'Unable to load playlist details due to YouTube API quota limit',
        details: 'The YouTube API has a daily quota limit that has been reached. Please try again tomorrow when the quota resets (midnight Pacific Time), or wait a few hours before trying again.'
      });
      return res.status(429).send(html);
    }

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
            <input type="radio" name="video-selection" id="video-${video.id}" value="${video.id}"
                   class="video-option-radio" style="display: none;">
            <label for="video-${video.id}" class="video-option p-3 border rounded mb-2" data-video-id="${video.id}">
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
                <div class="selection-indicator ms-2">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#28a745">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                </div>
              </div>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <form id="video-selection-form">
          <input type="hidden" name="newVideoId" id="hidden-new-video-id" value="">
          <input type="hidden" name="currentVideoId" value="${currentVideoId || ''}">
          <input type="hidden" name="playlistId" value="${playlistId}">

          <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
            Cancel
          </button>
          <button type="button" class="btn btn-primary" id="confirm-selection-btn"
                  hx-post="/api/playlistDetails/replace/${trackId}"
                  hx-include="#video-selection-form"
                  hx-swap="none"
                  data-playlist-id="${playlistId}"
                  disabled>
            Confirm Selection
          </button>
        </form>
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
    const youtubeTokens: YouTubeTokens | null = req.cookies.youtube_tokens ? JSON.parse(req.cookies.youtube_tokens) : null;
    const spotifyTokens: SpotifyTokens | null = req.cookies.spotify_tokens ? JSON.parse(req.cookies.spotify_tokens) : null;

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
      details: error instanceof Error ? error.message : 'Unknown error occurred'
    });
    res.status(500).send(html);
  }
});

export { router as playlistDetailsRouter };
